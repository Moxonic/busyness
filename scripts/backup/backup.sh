#!/usr/bin/env bash
# Nightly encrypted backup of the database and stored documents into a restic repository.
# restic encrypts everything (AES-256) before it leaves this machine; the repository lives
# with a different provider than the database (Backblaze B2, EU) so one outage cannot take both.
#
# Required env:  BACKUP_DATABASE_URL  RESTIC_REPOSITORY  RESTIC_PASSWORD
# For S3/B2:     AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY
# Documents:     FILES_SOURCE_DIR (local folder)  or  FILES_RCLONE_SOURCE (e.g. "r2:my-bucket")
# Retention:     BACKUP_KEEP_DAILY (30)  BACKUP_KEEP_MONTHLY (12)  BACKUP_KEEP_YEARLY (6)
set -euo pipefail

: "${BACKUP_DATABASE_URL:?missing}" "${RESTIC_REPOSITORY:?missing}" "${RESTIC_PASSWORD:?missing}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0

if ! restic cat config >/dev/null 2>&1; then
  echo "== Initialising new restic repository"
  restic init
fi

echo "== Database dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" --file="$WORK/db.dump"
pg_restore --list "$WORK/db.dump" >/dev/null # proves the dump is readable before we store it

# Record the audit log state at backup time. A broken chain is backed up anyway, but fails the job
# so you get an email.
read -r checked bad head < <(psql "$BACKUP_DATABASE_URL" -At -F ' ' \
  -c "select checked, coalesce(first_bad_seq::text, 'none'), coalesce(head_hash, 'empty') from audit_verify_chain()")
echo "   audit log: $checked entries, first broken: $bad, head: $head"
if [ "$bad" != "none" ]; then
  echo "!! AUDIT LOG CHAIN IS BROKEN at entry $bad" >&2
  status=1
fi

restic backup --host busyness --tag db --tag "audit-head:${head:0:16}" \
  --stdin --stdin-filename db.dump <"$WORK/db.dump"

echo "== Documents"
if [ -n "${FILES_RCLONE_SOURCE:-}" ]; then
  FILES_DIR=/tmp/busyness-files # fixed path so restic sees the same "folder" every night
  mkdir -p "$FILES_DIR"
  rclone sync "$FILES_RCLONE_SOURCE" "$FILES_DIR" --fast-list
elif [ -n "${FILES_SOURCE_DIR:-}" ]; then
  FILES_DIR="$FILES_SOURCE_DIR"
else
  FILES_DIR=""
  echo "   no document source configured, skipped"
fi
if [ -n "$FILES_DIR" ]; then
  restic backup --host busyness --tag files "$FILES_DIR"
fi

echo "== Retention"
restic forget --host busyness --prune \
  --keep-daily "${BACKUP_KEEP_DAILY:-30}" \
  --keep-monthly "${BACKUP_KEEP_MONTHLY:-12}" \
  --keep-yearly "${BACKUP_KEEP_YEARLY:-6}"

echo "== Done"
exit $status
