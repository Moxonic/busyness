-- Audit log integrity, automatic row-change auditing and file immutability.
-- Everything here is enforced by the database itself, so a bug in the app cannot bypass it.

CREATE SEQUENCE IF NOT EXISTS audit_log_seq;
--> statement-breakpoint

-- Canonical hash of one audit row. jsonb_build_array gives an unambiguous encoding
-- (no field can "leak" into its neighbour), and jsonb text output is deterministic.
CREATE OR REPLACE FUNCTION audit_compute_hash(r audit_log) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    r.seq,
    (extract(epoch FROM r.occurred_at) * 1000000)::bigint,
    r.actor_user_id,
    r.actor_label,
    r.action,
    r.entity_type,
    r.entity_id,
    r.before,
    r.after,
    r.ip,
    r.user_agent,
    r.request_id,
    r.prev_hash
  )::text, 'UTF8')), 'hex');
$$;
--> statement-breakpoint

-- Assigns sequence number, timestamp and hash chain. A transaction-level advisory lock
-- serialises writers so the chain can never fork; the lock is held until commit, so the
-- next writer always sees the previous row.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(7372001);
  SELECT hash INTO last_hash FROM audit_log ORDER BY seq DESC LIMIT 1;
  NEW.seq := nextval('audit_log_seq');
  NEW.occurred_at := clock_timestamp();
  NEW.prev_hash := coalesce(last_hash, repeat('0', 64));
  NEW.hash := audit_compute_hash(NEW);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();
--> statement-breakpoint

-- Verifies the whole chain. Returns the number of rows checked and the first broken row (null = intact).
CREATE OR REPLACE FUNCTION audit_verify_chain()
RETURNS TABLE (checked bigint, first_bad_seq bigint, head_hash text)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT a.seq, a.hash, a.prev_hash,
           lag(a.hash) OVER (ORDER BY a.seq) AS expected_prev,
           audit_compute_hash(a) AS recomputed
    FROM audit_log a
  )
  SELECT
    (SELECT count(*) FROM ordered),
    (SELECT min(seq) FROM ordered
      WHERE prev_hash IS DISTINCT FROM coalesce(expected_prev, repeat('0', 64))
         OR hash IS DISTINCT FROM recomputed),
    (SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1);
$$;
--> statement-breakpoint

-- Generic row-change audit. Trigger arguments = columns never copied into the log (secrets, noise).
-- The application must set app.actor_label (via withAudit) or the write is rejected,
-- so no change can happen "anonymously".
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  label text := nullif(current_setting('app.actor_label', true), '');
  redact boolean := coalesce(nullif(current_setting('app.audit_redact', true), ''), 'off') = 'on';
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD) - coalesce(TG_ARGV, '{}'::text[]); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_j := to_jsonb(NEW) - coalesce(TG_ARGV, '{}'::text[]); END IF;

  IF TG_OP = 'UPDATE' AND old_j = new_j THEN
    RETURN NULL; -- only excluded columns changed
  END IF;

  IF label IS NULL THEN
    RAISE EXCEPTION 'Audit context missing: changes to % must be made through withAudit()', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO audit_log (actor_user_id, actor_label, action, entity_type, entity_id,
                         before, after, ip, user_agent, request_id)
  VALUES (
    nullif(current_setting('app.actor_id', true), '')::uuid,
    label,
    lower(TG_OP),
    TG_TABLE_NAME,
    coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'key', old_j ->> 'key'),
    CASE WHEN redact AND old_j IS NOT NULL THEN '{"redacted": true}'::jsonb ELSE old_j END,
    CASE WHEN redact AND new_j IS NOT NULL THEN '{"redacted": true}'::jsonb ELSE new_j END,
    nullif(current_setting('app.ip', true), ''),
    nullif(current_setting('app.user_agent', true), ''),
    nullif(current_setting('app.request_id', true), '')
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER users_audit AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('password_hash', 'totp_secret_enc', 'totp_last_step', 'updated_at');
--> statement-breakpoint
CREATE TRIGGER invitations_audit AFTER INSERT OR UPDATE OR DELETE ON invitations
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('token_hash');
--> statement-breakpoint
CREATE TRIGGER company_audit AFTER INSERT OR UPDATE OR DELETE ON company
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('updated_at');
--> statement-breakpoint
CREATE TRIGGER settings_audit AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('updated_at');
--> statement-breakpoint
CREATE TRIGGER files_audit AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint

-- Stored documents are evidence: their content fingerprint can never change, and a file
-- can only be deleted once its retention date has passed.
CREATE OR REPLACE FUNCTION files_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes THEN
      RAISE EXCEPTION 'files: stored content cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.retain_until IS NULL OR OLD.retain_until::date >= current_date THEN
    RAISE EXCEPTION 'files: cannot delete a file before its retention date' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER files_guard BEFORE UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION files_guard();
--> statement-breakpoint

-- Single company row and default settings. Inserted by the migration owner, so mark the actor.
SELECT set_config('app.actor_label', 'system:migration', true);
--> statement-breakpoint
INSERT INTO company (id) VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO settings (key, value, description) VALUES
  ('retention.primary_documentation_years', '5',
   'Years after the end of the financial year that primary documentation is kept (bokføringsloven § 13). Confirm with your accountant.'),
  ('gdpr.audit_log_retention_note', '"The audit log is append-only and is kept as part of the accounting and security records."',
   'Shown on the privacy page. Review with a lawyer or accountant.')
ON CONFLICT DO NOTHING;
