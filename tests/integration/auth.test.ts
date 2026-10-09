import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import {
  acceptInvitationWithPassword,
  createInvitation,
  findUserByEmail,
  loginWithGoogle,
  loginWithPassword,
  requestPasswordReset,
  resetPassword,
  verifySecondFactor,
} from "@/server/auth/service";
import { PENDING_SESSION_MS, validateSessionToken } from "@/server/auth/session";
import { anonymizeUser, changeRole, deactivateUser, resetUserMfa } from "@/server/users/service";
import {
  codeFor,
  createEnrolledUser,
  ctxOf,
  currentStep,
  lastMailLinkTo,
  meta,
  STRONG_PASSWORD,
  systemCtx,
  uniqueEmail,
} from "../helpers";

async function eventsFor(userId: string, action: string) {
  return db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, userId), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.seq));
}

describe("invitation and two-factor enrolment", () => {
  it("creates a user only through an invitation, then requires 2FA", async () => {
    const { user, session, recoveryCodes } = await createEnrolledUser("employee");
    expect(user.totpEnabledAt).not.toBeNull();
    expect(recoveryCodes).toHaveLength(10);
    const valid = await validateSessionToken(session.token);
    expect(valid?.session.mfaVerifiedAt).not.toBeNull();
  });

  it("an invitation link works once", async () => {
    const email = uniqueEmail();
    const inv = await createInvitation(systemCtx, { email, role: "employee", inviterName: "T" });
    if (!inv.ok) throw new Error();
    const token = inv.link.split("/").pop()!;
    expect((await acceptInvitationWithPassword(token, { name: "A", password: STRONG_PASSWORD }, meta())).ok).toBe(true);
    const again = await acceptInvitationWithPassword(token, { name: "B", password: STRONG_PASSWORD }, meta());
    expect(again).toMatchObject({ ok: false, error: "invalidLink" });
  });

  it("rejects weak passwords when accepting", async () => {
    const email = uniqueEmail();
    const inv = await createInvitation(systemCtx, { email, role: "employee", inviterName: "T" });
    if (!inv.ok) throw new Error();
    const r = await acceptInvitationWithPassword(inv.link.split("/").pop()!, { name: "A", password: "short" }, meta());
    expect(r).toMatchObject({ ok: false, error: "tooShort" });
  });
});

describe("password login", () => {
  it("needs the second factor, and a TOTP code cannot be replayed", async () => {
    const { user, email, enrolledStep } = await createEnrolledUser();
    const m = meta();
    const first = await loginWithPassword(email, STRONG_PASSWORD, m);
    if (!first.ok) throw new Error(first.error);
    expect(first.next).toBe("mfa");
    const pending = await validateSessionToken(first.session.token);
    expect(pending?.session.mfaVerifiedAt).toBeNull();

    // The code used during enrolment is spent.
    const replay = await verifySecondFactor(sha256Hex(first.session.token), user.id, codeFor(user.totpSecretEnc!, enrolledStep), "totp", m);
    expect(replay).toMatchObject({ ok: false, error: "invalidCode" });

    const step = Math.max(currentStep(), enrolledStep) + 1;
    const code = codeFor(user.totpSecretEnc!, step);
    const ok = await verifySecondFactor(sha256Hex(first.session.token), user.id, code, "totp", m);
    expect(ok.ok).toBe(true);
    // The pending session was replaced.
    expect(await validateSessionToken(first.session.token)).toBeNull();
    expect((await eventsFor(user.id, "auth.login")).length).toBeGreaterThan(0);
  });

  it("recovery codes work exactly once", async () => {
    const { user, email, recoveryCodes } = await createEnrolledUser();
    const m = meta();
    const a = await loginWithPassword(email, STRONG_PASSWORD, m);
    if (!a.ok) throw new Error();
    const r1 = await verifySecondFactor(sha256Hex(a.session.token), user.id, recoveryCodes[0], "recovery", m);
    expect(r1).toMatchObject({ ok: true, remainingRecoveryCodes: 9 });
    const b = await loginWithPassword(email, STRONG_PASSWORD, m);
    if (!b.ok) throw new Error();
    const r2 = await verifySecondFactor(sha256Hex(b.session.token), user.id, recoveryCodes[0], "recovery", m);
    expect(r2).toMatchObject({ ok: false, error: "invalidCode" });
  });

  it("gives the same answer for unknown email and wrong password, and logs both", async () => {
    const { user, email } = await createEnrolledUser();
    const wrong = await loginWithPassword(email, "not-the-password-123", meta());
    const unknown = await loginWithPassword(uniqueEmail("nobody"), "whatever-password-1", meta());
    expect(wrong).toEqual({ ok: false, error: "invalidCredentials" });
    expect(unknown).toEqual({ ok: false, error: "invalidCredentials" });
    expect((await eventsFor(user.id, "auth.login_failed")).length).toBe(1);
  });

  it("locks an account after repeated failures, even for the right password", async () => {
    const { email } = await createEnrolledUser();
    for (let i = 0; i < 8; i++) await loginWithPassword(email, `wrong-password-${i}xx`, meta());
    const r = await loginWithPassword(email, STRONG_PASSWORD, meta());
    expect(r).toMatchObject({ ok: false, error: "rateLimited" });
  });

  it("limits attempts per IP address", async () => {
    const m = meta();
    let last;
    for (let i = 0; i < 31; i++) last = await loginWithPassword(uniqueEmail("ip"), "irrelevant-password", m);
    expect(last).toMatchObject({ ok: false, error: "rateLimited" });
  });

  it("limits second-factor guesses", async () => {
    const { user, email } = await createEnrolledUser();
    const m = meta();
    const a = await loginWithPassword(email, STRONG_PASSWORD, m);
    if (!a.ok) throw new Error();
    for (let i = 0; i < 6; i++) await verifySecondFactor(sha256Hex(a.session.token), user.id, "000000", "totp", m);
    const step = currentStep() + 1;
    const r = await verifySecondFactor(sha256Hex(a.session.token), user.id, codeFor(user.totpSecretEnc!, step), "totp", m);
    expect(r).toMatchObject({ ok: false, error: "rateLimited" });
  });
});

describe("sessions", () => {
  it("a pending (password-only) session expires after 10 minutes", async () => {
    const { email } = await createEnrolledUser();
    const a = await loginWithPassword(email, STRONG_PASSWORD, meta());
    if (!a.ok) throw new Error();
    const later = new Date(Date.now() + PENDING_SESSION_MS + 1000);
    expect(await validateSessionToken(a.session.token, later)).toBeNull();
  });

  it("a verified session expires when idle", async () => {
    const { session } = await createEnrolledUser();
    const later = new Date(Date.now() + 121 * 60_000);
    expect(await validateSessionToken(session.token, later)).toBeNull();
  });

  it("deactivating a user ends their sessions immediately", async () => {
    const owner = await createEnrolledUser("owner");
    const emp = await createEnrolledUser("employee");
    expect(await validateSessionToken(emp.session.token)).not.toBeNull();
    expect((await deactivateUser(ctxOf(owner.user), emp.user.id)).ok).toBe(true);
    expect(await validateSessionToken(emp.session.token)).toBeNull();
    const login = await loginWithPassword(emp.email, STRONG_PASSWORD, meta());
    expect(login).toMatchObject({ ok: false, error: "invalidCredentials" });
  });
});

describe("password reset", () => {
  it("resets via a single-use emailed link and logs out everywhere", async () => {
    const { email, session } = await createEnrolledUser();
    expect((await requestPasswordReset(email, meta())).ok).toBe(true);
    const token = lastMailLinkTo(email).split("/").pop()!;
    const newPassword = "another-very-long-passphrase-7";
    expect((await resetPassword(token, newPassword, meta())).ok).toBe(true);
    expect(await validateSessionToken(session.token)).toBeNull();
    expect((await resetPassword(token, "yet-another-passphrase-99", meta())).ok).toBe(false);
    expect((await loginWithPassword(email, newPassword, meta())).ok).toBe(true);
  });

  it("does not reveal whether an email exists", async () => {
    expect(await requestPasswordReset(uniqueEmail("ghost"), meta())).toEqual({ ok: true });
  });
});

describe("Google login", () => {
  const profile = (email: string, sub = `g-${email}`) => ({ sub, email, emailVerified: true, name: "Google User" });

  it("refuses people without a user or invitation", async () => {
    const r = await loginWithGoogle(profile(uniqueEmail("stranger")), null, meta());
    expect(r).toMatchObject({ ok: false, error: "noAccess" });
  });

  it("refuses unverified Google emails", async () => {
    const r = await loginWithGoogle({ ...profile(uniqueEmail()), emailVerified: false }, null, meta());
    expect(r).toMatchObject({ ok: false, error: "googleEmailUnverified" });
  });

  it("accepts an invitation and still requires 2FA setup", async () => {
    const email = uniqueEmail("google");
    await createInvitation(systemCtx, { email, role: "accountant", inviterName: "T" });
    const r = await loginWithGoogle(profile(email), null, meta());
    expect(r).toMatchObject({ ok: true, next: "setup-mfa" });
    expect((await findUserByEmail(email))?.role).toBe("accountant");
  });

  it("links to an existing user by verified email, but not to a second Google account", async () => {
    const { email } = await createEnrolledUser();
    expect(await loginWithGoogle(profile(email, "sub-1"), null, meta())).toMatchObject({ ok: true, next: "mfa" });
    expect(await loginWithGoogle(profile(email, "sub-2"), null, meta())).toMatchObject({ ok: false, error: "noAccess" });
  });
});

describe("user administration", () => {
  it("never removes the last owner", async () => {
    const owner = await createEnrolledUser("owner");
    // Other owners may exist from earlier tests; demote them all except ours via a fresh owner context.
    const others = await db().select().from(users).where(and(eq(users.role, "owner"), eq(users.status, "active")));
    for (const o of others) if (o.id !== owner.user.id) await deactivateUser(ctxOf(owner.user), o.id);
    const helper = await createEnrolledUser("owner");
    expect((await deactivateUser(ctxOf(helper.user), owner.user.id)).ok).toBe(true);
    // helper is now the only owner and cannot be demoted by anyone.
    const another = await createEnrolledUser("employee");
    expect(await changeRole({ ...ctxOf(another.user) }, helper.user.id, "employee")).toEqual({
      ok: false,
      error: "lastOwner",
    });
    expect(await deactivateUser(ctxOf(helper.user), helper.user.id)).toEqual({ ok: false, error: "self" });
  });

  it("resetting 2FA forces enrolment again", async () => {
    const owner = await createEnrolledUser("owner");
    const emp = await createEnrolledUser();
    await resetUserMfa(ctxOf(owner.user), emp.user.id);
    const r = await loginWithPassword(emp.email, STRONG_PASSWORD, meta());
    expect(r).toMatchObject({ ok: true, next: "setup-mfa" });
  });

  it("anonymises a deactivated user without copying their data into the audit log", async () => {
    const owner = await createEnrolledUser("owner");
    const emp = await createEnrolledUser();
    expect(await anonymizeUser(ctxOf(owner.user), emp.user.id)).toEqual({ ok: false, error: "notDeactivated" });
    await deactivateUser(ctxOf(owner.user), emp.user.id);
    expect((await anonymizeUser(ctxOf(owner.user), emp.user.id)).ok).toBe(true);
    const after = (await db().select().from(users).where(eq(users.id, emp.user.id)))[0];
    expect(after.email).toMatch(/^deleted-.*@invalid\.local$/);
    expect(after.name).toBe("Slettet bruker");
    const [last] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "users"), eq(auditLog.entityId, emp.user.id)))
      .orderBy(desc(auditLog.seq))
      .limit(1);
    expect(last.after).toEqual({ redacted: true });
    expect(JSON.stringify(last)).not.toContain(emp.email);
  });
});
