#!/usr/bin/env bash
# Proves the latest backup can be restored: restores it into a scratch database, checks the
# audit log hash chain and that every stored document matches its recorded SHA-256, then
# drops the scratch database. Runs weekly in GitHub Actions; run it by hand any time.
#
# Required env:  RESTORE_ADMIN_URL (a Postgres server where a scratch database may be created,
#                e.g. postgres://user:pw@host:5432/postgres)  RESTIC_REPOSITORY  RESTIC_PASSWORD
# Optional:      KEEP_RESTORED_DB=1 keeps the scratch database for inspection.
set -euo pipefail

: "${RESTORE_ADMIN_URL:?missing}" "${RESTIC_REPOSITORY:?missing}" "${RESTIC_PASSWORD:?missing}"
WORK="$(mktemp -d)"
DB="restore_test_$(date +%s)"
BASE="${RESTORE_ADMIN_URL%/*}"
TARGET="$BASE/$DB"

cleanup() {
  rm -rf "$WORK"
  if [ "${KEEP_RESTORED_DB:-0}" != "1" ]; then
    psql "$RESTORE_ADMIN_URL" -q -c "drop database if exists $DB" || true
  fi
}
trap cleanup EXIT

echo "== Repository integrity (5% of data re-read)"
restic check --read-data-subset=5%

echo "== Latest database snapshot"
restic snapshots --host busyness --tag db --latest 1
restic dump --host busyness --tag db latest /db.dump >"$WORK/db.dump"

echo "== Restoring into scratch database $DB"
psql "$RESTORE_ADMIN_URL" -q -c "create database $DB"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$WORK/db.dump"

echo "== Checks"
read -r checked bad head < <(psql "$TARGET" -At -F ' ' \
  -c "select checked, coalesce(first_bad_seq::text, 'none'), coalesce(head_hash, 'empty') from audit_verify_chain()")
echo "   audit log: $checked entries, chain broken at: $bad, head: $head"
[ "$bad" = "none" ] || { echo "!! restored audit log chain is broken" >&2; exit 1; }
[ "$checked" -gt 0 ] || { echo "!! restored audit log is empty" >&2; exit 1; }

psql "$TARGET" -At -c "select 'users: ' || count(*) from users"
psql "$TARGET" -At -c "select 'company: ' || name from company"

file_count=$(psql "$TARGET" -At -c "select count(*) from files")
echo "   documents recorded: $file_count"
if [ "$file_count" -gt 0 ]; then
  if ! restic snapshots --host busyness --tag files --latest 1 --json | grep -q '"paths"'; then
    echo "!! database lists documents but there is no documents snapshot" >&2
    exit 1
  fi
  src=$(restic snapshots --host busyness --tag files --latest 1 --json | sed -n 's/.*"paths":\["\([^"]*\)".*/\1/p')
  restic restore latest --host busyness --tag files --target "$WORK/files" >/dev/null
  bad_files=0
  while IFS='|' read -r key sum; do
    f="$WORK/files$src/$key"
    if [ ! -f "$f" ] || [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sum" ]; then
      echo "   MISSING OR CHANGED: $key" >&2
      bad_files=$((bad_files + 1))
    fi
  done < <(psql "$TARGET" -At -F '|' -c "select storage_key, sha256 from files")
  [ "$bad_files" -eq 0 ] || { echo "!! $bad_files documents failed verification" >&2; exit 1; }
  echo "   all $file_count documents present and unchanged"
fi

echo "== Restore test PASSED"
