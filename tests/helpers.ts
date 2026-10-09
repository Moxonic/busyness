import { generateHOTP } from "@oslojs/otp";
import postgres from "postgres";
import { afterAll } from "vitest";
import { closeDb } from "@/db";
import type { AuditContext } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { consoleOutbox } from "@/lib/mail";
import { TOTP_PERIOD } from "@/lib/totp";
import type { RequestMeta } from "@/server/auth/service";
import {
  acceptInvitationWithPassword,
  confirmTotpEnrollment,
  createInvitation,
  findUserByEmail,
  startTotpEnrollment,
} from "@/server/auth/service";
import { sha256Hex } from "@/lib/crypto";
import type { Role } from "@/db/schema";

afterAll(async () => {
  await closeDb();
});

let counter = 0;
export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${Date.now()}-${++counter}@example.test`;
}

/** Each test gets its own IP so IP rate limits do not leak between tests. */
export function meta(): RequestMeta {
  return { ip: `10.0.${Math.floor(Math.random() * 250)}.${++counter % 250}`, userAgent: "vitest", requestId: null };
}

export const systemCtx: AuditContext = { actorId: null, actorLabel: "test-system" };

/** Owner connection, for checks the app role must not be able to do. */
export function ownerSql() {
  return postgres(process.env.DATABASE_MIGRATION_URL!, { max: 1, onnotice: () => {} });
}

export function currentStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD);
}

export function codeFor(secretEnc: string, step: number): string {
  return generateHOTP(decryptSecret(secretEnc), BigInt(step), 6);
}

export const STRONG_PASSWORD = "correct-horse-battery-staple-42";

export function lastMailLinkTo(email: string): string {
  const mail = [...consoleOutbox].reverse().find((m) => m.to === email);
  const match = mail?.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`No link mailed to ${email}`);
  return match[0];
}

/** Creates a fully enrolled user via the real invite + 2FA flow. */
export async function createEnrolledUser(role: Role = "employee", inviter: AuditContext = systemCtx) {
  const email = uniqueEmail(role);
  const m = meta();
  const inv = await createInvitation(inviter, { email, role, inviterName: "Test" });
  if (!inv.ok) throw new Error(`invite failed: ${inv.error}`);
  const token = inv.link.split("/").pop()!;
  const accepted = await acceptInvitationWithPassword(token, { name: "Test User", password: STRONG_PASSWORD }, m);
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.error}`);
  let user = (await findUserByEmail(email))!;
  await startTotpEnrollment(user.id, "Test");
  user = (await findUserByEmail(email))!;
  const step = currentStep();
  const confirmed = await confirmTotpEnrollment(
    sha256Hex(accepted.session.token),
    user.id,
    codeFor(user.totpSecretEnc!, step),
    m,
  );
  if (!confirmed.ok) throw new Error(`enrol failed: ${confirmed.error}`);
  user = (await findUserByEmail(email))!;
  return { user, email, session: confirmed.session, recoveryCodes: confirmed.recoveryCodes, enrolledStep: step };
}

export function ctxOf(user: { id: string; email: string }): AuditContext {
  return { actorId: user.id, actorLabel: user.email };
}

/** Asserts that a query fails with a database error matching `pattern` (Drizzle wraps the original). */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    const message = `${e.message}\n${e.cause?.message ?? ""}`;
    if (!pattern.test(message)) throw new Error(`Expected error matching ${pattern}, got: ${message}`);
    return;
  }
  throw new Error(`Expected query to fail with ${pattern}, but it succeeded`);
}
