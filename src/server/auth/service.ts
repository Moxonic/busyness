import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { company, invitations, passwordResetTokens, recoveryCodes, users, type Role, type User } from "@/db/schema";
import { env } from "@/env";
import { recordEvent, withAudit, type AuditContext } from "@/lib/audit";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/crypto";
import { inviteMail, passwordResetMail, sendMail } from "@/lib/mail";
import { burnPasswordCheck, checkPasswordPolicy, hashPassword, verifyPassword, type PasswordProblem } from "@/lib/password";
import { consume, LIMITS, peek, resetLimit } from "@/lib/ratelimit";
import { generateRecoveryCodes, hashRecoveryCode, matchTotpStep, newTotpKey, totpManualKey, totpUri } from "@/lib/totp";
import { createSession, invalidateSession, invalidateUserSessions, type SessionMeta } from "./session";

/**
 * Authentication and user-management rules. Framework independent: server actions and
 * route handlers call these, and the integration tests call them directly.
 */

export type RequestMeta = SessionMeta & { requestId: string | null };
export type NewSession = { token: string; expiresAt: Date };
export type AuthError =
  | "invalidCredentials"
  | "rateLimited"
  | "invalidCode"
  | "invalidLink"
  | "noAccess"
  | "googleEmailUnverified"
  | "inviteEmailMismatch"
  | "alreadyEnrolled"
  | "notEnrolled"
  | PasswordProblem;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: AuthError; retryAfterSec?: number };

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
export const RESET_TTL_MS = 3600_000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ctxFor(user: Pick<User, "id" | "email">, meta: RequestMeta): AuditContext {
  return { actorId: user.id, actorLabel: user.email, ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId };
}

function anonCtx(meta: RequestMeta, label = "anonymous"): AuditContext {
  return { actorId: null, actorLabel: label, ip: meta.ip, userAgent: meta.userAgent, requestId: meta.requestId };
}

export async function findUserByEmail(email: string) {
  return db().query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
}

export async function findUserById(id: string) {
  return db().query.users.findFirst({ where: eq(users.id, id) });
}

async function companyName(): Promise<string> {
  const c = await db().query.company.findFirst({ where: eq(company.id, 1) });
  return c?.name ?? "";
}

// ---------------------------------------------------------------------------
// Login, step 1: password. Creates a *pending* session that only allows the 2FA step.

export type FirstFactorResult = Result<{ session: NewSession; next: "mfa" | "setup-mfa" }>;

export async function loginWithPassword(email: string, password: string, meta: RequestMeta): Promise<FirstFactorResult> {
  const normalized = normalizeEmail(email);
  const ipLimit = await consume(`login:ip:${meta.ip ?? "unknown"}`, LIMITS.loginIp);
  if (!ipLimit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: ipLimit.retryAfterSec };

  const accountKey = `login:acct:${normalized}`;
  const accountLimit = await peek(accountKey, LIMITS.loginAccount);
  if (!accountLimit.allowed) {
    await recordEvent(db(), anonCtx(meta), { action: "auth.login_blocked", details: { reason: "too_many_failures" } });
    return { ok: false, error: "rateLimited", retryAfterSec: accountLimit.retryAfterSec };
  }

  const user = await findUserByEmail(normalized);
  let valid = false;
  if (user?.passwordHash) valid = await verifyPassword(user.passwordHash, password);
  else await burnPasswordCheck(password);

  if (!user || !valid || user.status !== "active") {
    await consume(accountKey, LIMITS.loginAccount);
    // The typed email is not logged for unknown accounts: people sometimes type a password there.
    await recordEvent(db(), user ? ctxFor(user, meta) : anonCtx(meta), {
      action: "auth.login_failed",
      details: { reason: !user ? "unknown_email" : user.status !== "active" ? `user_${user.status}` : "wrong_password" },
    });
    return { ok: false, error: "invalidCredentials" };
  }

  await resetLimit(accountKey);
  const session = await createSession(db(), user.id, { ...meta, mfaVerified: false });
  return { ok: true, session, next: user.totpEnabledAt ? "mfa" : "setup-mfa" };
}

// ---------------------------------------------------------------------------
// Login with Google. Only for people who already have a user or a pending invitation.

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string | null };

export async function loginWithGoogle(
  profile: GoogleProfile,
  inviteToken: string | null,
  meta: RequestMeta,
): Promise<FirstFactorResult> {
  const ipLimit = await consume(`login:ip:${meta.ip ?? "unknown"}`, LIMITS.loginIp);
  if (!ipLimit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: ipLimit.retryAfterSec };
  if (!profile.emailVerified) return { ok: false, error: "googleEmailUnverified" };

  const email = normalizeEmail(profile.email);
  let user =
    (await db().query.users.findFirst({ where: eq(users.googleSub, profile.sub) })) ?? (await findUserByEmail(email));

  if (user) {
    if (user.status !== "active" || (user.googleSub && user.googleSub !== profile.sub)) {
      await recordEvent(db(), ctxFor(user, meta), { action: "auth.login_failed", details: { reason: "google_rejected" } });
      return { ok: false, error: "noAccess" };
    }
    if (!user.googleSub) {
      const u = user;
      await withAudit(ctxFor(u, meta), (tx) =>
        tx.update(users).set({ googleSub: profile.sub, updatedAt: new Date() }).where(eq(users.id, u.id)),
      );
    }
  } else {
    const invite = inviteToken ? await getValidInvitation(inviteToken) : await findValidInvitationByEmail(email);
    if (!invite) {
      await recordEvent(db(), anonCtx(meta), { action: "auth.login_failed", details: { reason: "google_no_account" } });
      return { ok: false, error: "noAccess" };
    }
    if (invite.email !== email) return { ok: false, error: "inviteEmailMismatch" };
    const created = await createUserFromInvitation(invite.id, { email, name: profile.name || email, googleSub: profile.sub }, meta);
    if (!created) return { ok: false, error: "invalidLink" };
    user = created;
  }

  const session = await createSession(db(), user.id, { ...meta, mfaVerified: false });
  return { ok: true, session, next: user.totpEnabledAt ? "mfa" : "setup-mfa" };
}

// ---------------------------------------------------------------------------
// Login, step 2: authenticator code or recovery code. Replaces the pending session.

export async function verifySecondFactor(
  pendingSessionId: string,
  userId: string,
  code: string,
  method: "totp" | "recovery",
  meta: RequestMeta,
): Promise<Result<{ session: NewSession; remainingRecoveryCodes: number }>> {
  const limitKey = `mfa:user:${userId}`;
  const limit = await peek(limitKey, LIMITS.mfaUser);
  if (!limit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: limit.retryAfterSec };

  const user = await findUserById(userId);
  if (!user || user.status !== "active" || !user.totpSecretEnc || !user.totpEnabledAt) {
    return { ok: false, error: "notEnrolled" };
  }

  let accepted = false;
  if (method === "totp") {
    const step = matchTotpStep(decryptSecret(user.totpSecretEnc), code, user.totpLastStep);
    if (step !== null) {
      // Atomic: two concurrent requests with the same code cannot both succeed.
      const updated = await db()
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), sql`(${users.totpLastStep} is null or ${users.totpLastStep} < ${step})`))
        .returning({ id: users.id });
      accepted = updated.length === 1;
    }
  } else {
    const used = await db()
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hashRecoveryCode(code)), isNull(recoveryCodes.usedAt)),
      )
      .returning({ id: recoveryCodes.id });
    accepted = used.length === 1;
  }

  if (!accepted) {
    await consume(limitKey, LIMITS.mfaUser);
    await recordEvent(db(), ctxFor(user, meta), { action: "auth.mfa_failed", details: { method } });
    return { ok: false, error: "invalidCode" };
  }

  await resetLimit(limitKey);
  const remaining = await countUnusedRecoveryCodes(userId);
  const session = await db().transaction(async (tx) => {
    await invalidateSession(pendingSessionId, tx);
    const s = await createSession(tx, userId, { ...meta, mfaVerified: true });
    await recordEvent(tx, ctxFor(user, meta), {
      action: "auth.login",
      details: { secondFactor: method, remainingRecoveryCodes: remaining },
    });
    return s;
  });
  return { ok: true, session, remainingRecoveryCodes: remaining };
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const r = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from recovery_codes where user_id = ${userId} and used_at is null`,
  );
  return r[0].n;
}

// ---------------------------------------------------------------------------
// Two-factor enrolment (mandatory for everyone).

export async function startTotpEnrollment(userId: string, issuer: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found");
  if (user.totpEnabledAt) return { ok: false as const, error: "alreadyEnrolled" as const };
  let key: Uint8Array;
  if (user.totpSecretEnc) {
    key = decryptSecret(user.totpSecretEnc);
  } else {
    key = newTotpKey();
    // Only the encrypted secret column changes, which the audit trigger deliberately ignores.
    await db().update(users).set({ totpSecretEnc: encryptSecret(key) }).where(eq(users.id, userId));
  }
  return { ok: true as const, uri: totpUri(issuer, user.email, key), manualKey: totpManualKey(key) };
}

export async function confirmTotpEnrollment(
  pendingSessionId: string,
  userId: string,
  code: string,
  meta: RequestMeta,
): Promise<Result<{ session: NewSession; recoveryCodes: string[] }>> {
  const limitKey = `mfa:user:${userId}`;
  const limit = await peek(limitKey, LIMITS.mfaUser);
  if (!limit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: limit.retryAfterSec };

  const user = await findUserById(userId);
  if (!user?.totpSecretEnc) return { ok: false, error: "notEnrolled" };
  if (user.totpEnabledAt) return { ok: false, error: "alreadyEnrolled" };

  const step = matchTotpStep(decryptSecret(user.totpSecretEnc), code, user.totpLastStep);
  if (step === null) {
    await consume(limitKey, LIMITS.mfaUser);
    return { ok: false, error: "invalidCode" };
  }
  await resetLimit(limitKey);

  const codes = generateRecoveryCodes();
  const session = await withAudit(ctxFor(user, meta), async (tx) => {
    await tx
      .update(users)
      .set({ totpEnabledAt: new Date(), totpLastStep: step, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
    await invalidateSession(pendingSessionId, tx);
    const s = await createSession(tx, userId, { ...meta, mfaVerified: true });
    await recordEvent(tx, ctxFor(user, meta), { action: "auth.mfa_enrolled" });
    await recordEvent(tx, ctxFor(user, meta), { action: "auth.login", details: { secondFactor: "totp_enrolment" } });
    return s;
  });
  return { ok: true, session, recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(
  user: Pick<User, "id" | "email">,
  totpCode: string,
  meta: RequestMeta,
): Promise<Result<{ codes: string[] }>> {
  const limitKey = `mfa:user:${user.id}`;
  const limit = await peek(limitKey, LIMITS.mfaUser);
  if (!limit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: limit.retryAfterSec };
  const fresh = await findUserById(user.id);
  if (!fresh?.totpSecretEnc || !fresh.totpEnabledAt) return { ok: false, error: "notEnrolled" };
  const step = matchTotpStep(decryptSecret(fresh.totpSecretEnc), totpCode, fresh.totpLastStep);
  if (step === null) {
    await consume(limitKey, LIMITS.mfaUser);
    return { ok: false, error: "invalidCode" };
  }
  const codes = generateRecoveryCodes();
  await withAudit(ctxFor(user, meta), async (tx) => {
    await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })));
    await recordEvent(tx, ctxFor(user, meta), { action: "auth.recovery_codes_regenerated" });
  });
  return { ok: true, codes };
}

// ---------------------------------------------------------------------------
// Invitations. Nobody can sign up on their own.

export async function createInvitation(
  ctx: AuditContext,
  input: { email: string; role: Role; inviterName: string },
): Promise<Result<{ link: string }>> {
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(email);
  if (existing && existing.status !== "anonymized") return { ok: false, error: "noAccess" };

  const token = randomToken();
  await withAudit(ctx, async (tx) => {
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await tx.insert(invitations).values({
      email,
      role: input.role,
      tokenHash: sha256Hex(token),
      invitedBy: ctx.actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
  });
  const link = `${env().APP_URL}/invite/${token}`;
  await sendMail(inviteMail(email, link, await companyName(), input.inviterName));
  return { ok: true, link };
}

export async function getValidInvitation(token: string) {
  if (!/^[a-z2-7]{32}$/.test(token)) return undefined;
  return db().query.invitations.findFirst({
    where: and(
      eq(invitations.tokenHash, sha256Hex(token)),
      isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt),
      gt(invitations.expiresAt, new Date()),
    ),
  });
}

async function findValidInvitationByEmail(email: string) {
  return db().query.invitations.findFirst({
    where: and(
      eq(invitations.email, email),
      isNull(invitations.acceptedAt),
      isNull(invitations.revokedAt),
      gt(invitations.expiresAt, new Date()),
    ),
  });
}

async function createUserFromInvitation(
  invitationId: string,
  data: { email: string; name: string; passwordHash?: string; googleSub?: string },
  meta: RequestMeta,
): Promise<User | null> {
  const id = crypto.randomUUID();
  return withAudit(ctxFor({ id, email: data.email }, meta), async (tx) => {
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning();
    if (claimed.length !== 1) return null;
    const [user] = await tx
      .insert(users)
      .values({
        id,
        email: data.email,
        name: data.name.trim().slice(0, 100),
        role: claimed[0].role,
        passwordHash: data.passwordHash ?? null,
        passwordChangedAt: data.passwordHash ? new Date() : null,
        googleSub: data.googleSub ?? null,
      })
      .returning();
    return user;
  });
}

export async function acceptInvitationWithPassword(
  token: string,
  input: { name: string; password: string },
  meta: RequestMeta,
): Promise<FirstFactorResult> {
  const limit = await consume(`invite:ip:${meta.ip ?? "unknown"}`, LIMITS.inviteIp);
  if (!limit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: limit.retryAfterSec };
  const invite = await getValidInvitation(token);
  if (!invite) return { ok: false, error: "invalidLink" };
  const problem = await checkPasswordPolicy(input.password, invite.email);
  if (problem) return { ok: false, error: problem };
  const user = await createUserFromInvitation(
    invite.id,
    { email: invite.email, name: input.name, passwordHash: await hashPassword(input.password) },
    meta,
  );
  if (!user) return { ok: false, error: "invalidLink" };
  const session = await createSession(db(), user.id, { ...meta, mfaVerified: false });
  return { ok: true, session, next: "setup-mfa" };
}

export async function revokeInvitation(ctx: AuditContext, invitationId: string): Promise<void> {
  await withAudit(ctx, (tx) =>
    tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt))),
  );
}

// ---------------------------------------------------------------------------
// Password reset and change.

/** Always "succeeds" so the form cannot be used to find out which emails have accounts. */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<Result> {
  const normalized = normalizeEmail(email);
  const ip = await consume(`reset:ip:${meta.ip ?? "unknown"}`, LIMITS.resetIp);
  if (!ip.allowed) return { ok: false, error: "rateLimited", retryAfterSec: ip.retryAfterSec };
  const perEmail = await consume(`reset:email:${normalized}`, LIMITS.resetEmail);
  if (!perEmail.allowed) return { ok: true };

  const user = await findUserByEmail(normalized);
  if (!user || user.status !== "active") return { ok: true };
  const token = randomToken();
  await db()
    .insert(passwordResetTokens)
    .values({ id: sha256Hex(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  await recordEvent(db(), ctxFor(user, meta), { action: "auth.password_reset_requested" });
  await sendMail(passwordResetMail(user.email, `${env().APP_URL}/reset-password/${token}`));
  return { ok: true };
}

export async function resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<Result> {
  if (!/^[a-z2-7]{32}$/.test(token)) return { ok: false, error: "invalidLink" };
  const row = await db().query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.id, sha256Hex(token)),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ),
  });
  if (!row) return { ok: false, error: "invalidLink" };
  const user = await findUserById(row.userId);
  if (!user || user.status !== "active") return { ok: false, error: "invalidLink" };
  const problem = await checkPasswordPolicy(newPassword, user.email);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(newPassword);

  const ok = await withAudit(ctxFor(user, meta), async (tx) => {
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length !== 1) return false;
    await tx
      .update(users)
      .set({ passwordHash: hash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await invalidateUserSessions(user.id, tx);
    await recordEvent(tx, ctxFor(user, meta), { action: "auth.password_reset" });
    return true;
  });
  return ok ? { ok: true } : { ok: false, error: "invalidLink" };
}

export async function changePassword(
  user: Pick<User, "id" | "email">,
  currentSessionId: string,
  current: string,
  next: string,
  meta: RequestMeta,
): Promise<Result> {
  const fresh = await findUserById(user.id);
  if (!fresh) return { ok: false, error: "invalidCredentials" };
  if (fresh.passwordHash && !(await verifyPassword(fresh.passwordHash, current))) {
    await recordEvent(db(), ctxFor(user, meta), { action: "auth.password_change_failed" });
    return { ok: false, error: "invalidCredentials" };
  }
  const problem = await checkPasswordPolicy(next, fresh.email);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(next);
  await withAudit(ctxFor(user, meta), async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: hash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await invalidateUserSessions(user.id, tx, currentSessionId);
    await recordEvent(tx, ctxFor(user, meta), { action: "auth.password_changed" });
  });
  return { ok: true };
}

export async function logout(sessionId: string, user: Pick<User, "id" | "email">, meta: RequestMeta) {
  await invalidateSession(sessionId);
  await recordEvent(db(), ctxFor(user, meta), { action: "auth.logout" });
}
