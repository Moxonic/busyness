import { sql } from "drizzle-orm";
import { db, type Executor, type Tx } from "@/db";
import { auditLog } from "@/db/schema";

/** Who is acting, and from where. Every change to audited tables needs one. */
export type AuditContext = {
  actorId: string | null;
  actorLabel: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export const SYSTEM_CONTEXT: AuditContext = { actorId: null, actorLabel: "system" };

/**
 * Runs `fn` in a transaction where database triggers record every change to audited
 * tables together with this context. The change and its audit rows commit or roll back
 * together, so the log can never miss a change or describe one that did not happen.
 *
 * `redact` stores "{redacted: true}" instead of row contents; used only for GDPR anonymisation,
 * where copying the personal data into the log would defeat the purpose.
 */
export async function withAudit<T>(
  ctx: AuditContext,
  fn: (tx: Tx) => Promise<T>,
  opts: { redact?: boolean } = {},
): Promise<T> {
  return db().transaction(async (tx) => {
    await setAuditContext(tx, ctx, opts);
    return fn(tx);
  });
}

export async function setAuditContext(tx: Tx, ctx: AuditContext, opts: { redact?: boolean } = {}) {
  await tx.execute(sql`select
    set_config('app.actor_id', ${ctx.actorId ?? ""}, true),
    set_config('app.actor_label', ${ctx.actorLabel}, true),
    set_config('app.ip', ${ctx.ip ?? ""}, true),
    set_config('app.user_agent', ${ctx.userAgent ?? ""}, true),
    set_config('app.request_id', ${ctx.requestId ?? ""}, true),
    set_config('app.audit_redact', ${opts.redact ? "on" : "off"}, true)`);
}

/** Records an event that is not a row change: logins, failed logins, exports, downloads. */
export async function recordEvent(
  ex: Executor,
  ctx: AuditContext,
  event: { action: string; entityType?: string; entityId?: string; details?: Record<string, unknown> },
): Promise<void> {
  await ex.insert(auditLog).values({
    actorUserId: ctx.actorId,
    actorLabel: ctx.actorLabel,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    after: event.details ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId ?? null,
  });
}

export type ChainVerification = { ok: boolean; checked: number; firstBadSeq: number | null; headHash: string | null };

export async function verifyAuditChain(ex: Executor = db()): Promise<ChainVerification> {
  const rows = await ex.execute<{ checked: string; first_bad_seq: string | null; head_hash: string | null }>(
    sql`select * from audit_verify_chain()`,
  );
  const r = rows[0];
  return {
    ok: r.first_bad_seq === null,
    checked: Number(r.checked),
    firstBadSeq: r.first_bad_seq === null ? null : Number(r.first_bad_seq),
    headHash: r.head_hash,
  };
}
