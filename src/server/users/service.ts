import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { auditLog, invitations, recoveryCodes, sessions, users, type Role } from "@/db/schema";
import { recordEvent, withAudit, type AuditContext } from "@/lib/audit";
import { invalidateUserSessions } from "@/server/auth/session";

export type AdminError = "notFound" | "self" | "lastOwner" | "notDeactivated" | "notActive";
export type AdminResult = { ok: true } | { ok: false; error: AdminError };

/** Locks the active owners so two concurrent changes cannot remove the last one. */
async function activeOwnerIds(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from users where role = 'owner' and status = 'active' for update`,
  );
  return rows.map((r) => r.id);
}

async function loadTarget(tx: Tx, id: string) {
  const rows = await tx.select().from(users).where(eq(users.id, id)).for("update");
  return rows[0];
}

export async function changeRole(ctx: AuditContext, targetId: string, role: Role): Promise<AdminResult> {
  if (targetId === ctx.actorId) return { ok: false, error: "self" };
  return withAudit(ctx, async (tx) => {
    const owners = await activeOwnerIds(tx);
    const target = await loadTarget(tx, targetId);
    if (!target) return { ok: false, error: "notFound" } as const;
    if (target.role === "owner" && role !== "owner" && owners.length <= 1 && owners.includes(target.id)) {
      return { ok: false, error: "lastOwner" } as const;
    }
    await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, targetId));
    await invalidateUserSessions(targetId, tx); // new permissions apply from next login
    return { ok: true } as const;
  });
}

export async function deactivateUser(ctx: AuditContext, targetId: string): Promise<AdminResult> {
  if (targetId === ctx.actorId) return { ok: false, error: "self" };
  return withAudit(ctx, async (tx) => {
    const owners = await activeOwnerIds(tx);
    const target = await loadTarget(tx, targetId);
    if (!target) return { ok: false, error: "notFound" } as const;
    if (target.status !== "active") return { ok: false, error: "notActive" } as const;
    if (owners.length <= 1 && owners.includes(target.id)) return { ok: false, error: "lastOwner" } as const;
    await tx
      .update(users)
      .set({ status: "deactivated", deactivatedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, targetId));
    await invalidateUserSessions(targetId, tx);
    return { ok: true } as const;
  });
}

export async function reactivateUser(ctx: AuditContext, targetId: string): Promise<AdminResult> {
  return withAudit(ctx, async (tx) => {
    const target = await loadTarget(tx, targetId);
    if (!target) return { ok: false, error: "notFound" } as const;
    if (target.status !== "deactivated") return { ok: false, error: "notDeactivated" } as const;
    await tx
      .update(users)
      .set({ status: "active", deactivatedAt: null, updatedAt: new Date() })
      .where(eq(users.id, targetId));
    return { ok: true } as const;
  });
}

/** For a user who lost their phone and recovery codes. They must set up 2FA again at next login. */
export async function resetUserMfa(ctx: AuditContext, targetId: string, allowSelf = false): Promise<AdminResult> {
  if (targetId === ctx.actorId && !allowSelf) return { ok: false, error: "self" };
  return withAudit(ctx, async (tx) => {
    const target = await loadTarget(tx, targetId);
    if (!target) return { ok: false, error: "notFound" } as const;
    await tx
      .update(users)
      .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, targetId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, targetId));
    await invalidateUserSessions(targetId, tx);
    await recordEvent(tx, ctx, { action: "auth.mfa_reset", entityType: "users", entityId: targetId });
    return { ok: true } as const;
  });
}

/**
 * GDPR erasure for a former user. The user row is kept (other records point to it), but
 * every personal field is replaced. The change is logged with contents redacted. Earlier
 * audit entries are not altered: the audit log is append-only (see README, "GDPR").
 */
export async function anonymizeUser(ctx: AuditContext, targetId: string): Promise<AdminResult> {
  if (targetId === ctx.actorId) return { ok: false, error: "self" };
  return withAudit(
    ctx,
    async (tx) => {
      const target = await loadTarget(tx, targetId);
      if (!target) return { ok: false, error: "notFound" } as const;
      if (target.status !== "deactivated") return { ok: false, error: "notDeactivated" } as const;
      const placeholder = `deleted-${target.id}@invalid.local`;
      await tx.update(invitations).set({ email: placeholder }).where(eq(invitations.email, target.email));
      await tx
        .update(users)
        .set({
          status: "anonymized",
          name: "Slettet bruker",
          email: placeholder,
          passwordHash: null,
          googleSub: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, targetId));
      await tx.delete(sessions).where(eq(sessions.userId, targetId));
      return { ok: true } as const;
    },
    { redact: true },
  );
}

/** Everything stored about one user, as a JSON-serialisable object (GDPR art. 15/20). */
export async function exportUserData(ctx: AuditContext, targetId: string) {
  const user = await db().query.users.findFirst({ where: eq(users.id, targetId) });
  if (!user) return null;
  const [userSessions, events, invitesSent] = await Promise.all([
    db()
      .select({
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, targetId)),
    db()
      .select({
        seq: auditLog.seq,
        occurredAt: auditLog.occurredAt,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        ip: auditLog.ip,
        userAgent: auditLog.userAgent,
      })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, targetId))
      .orderBy(desc(auditLog.seq)),
    db()
      .select({ email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
      .from(invitations)
      .where(and(eq(invitations.invitedBy, targetId))),
  ]);
  await recordEvent(db(), ctx, { action: "gdpr.export", entityType: "users", entityId: targetId });
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      locale: user.locale,
      createdAt: user.createdAt,
      passwordChangedAt: user.passwordChangedAt,
      googleLinked: Boolean(user.googleSub),
      twoFactorEnabledAt: user.totpEnabledAt,
      deactivatedAt: user.deactivatedAt,
    },
    sessions: userSessions,
    activity: events,
    invitationsSent: invitesSent,
    note: "Password hashes and two-factor secrets are not included: they cannot be read back by design.",
  };
}

export async function setLocale(ctx: AuditContext, userId: string, locale: "nb" | "en") {
  await withAudit(ctx, (tx) => tx.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, userId)));
}
