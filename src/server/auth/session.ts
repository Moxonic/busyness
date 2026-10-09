import { and, eq, lt, ne, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { env } from "@/env";
import { randomToken, sha256Hex } from "@/lib/crypto";

export type Session = typeof sessions.$inferSelect;
export type SessionMeta = { ip: string | null; userAgent: string | null };
export type SessionWithUser = { session: Session; user: User };

/** A session waiting for its second factor lives at most this long. */
export const PENDING_SESSION_MS = 10 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export async function createSession(
  ex: Executor,
  userId: string,
  opts: SessionMeta & { mfaVerified: boolean },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const now = new Date();
  const ttl = opts.mfaVerified ? env().SESSION_MAX_HOURS * 3600_000 : PENDING_SESSION_MS;
  const expiresAt = new Date(now.getTime() + ttl);
  await ex.insert(sessions).values({
    id: sha256Hex(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    mfaVerifiedAt: opts.mfaVerified ? now : null,
    ip: opts.ip,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string, now = new Date()): Promise<SessionWithUser | null> {
  if (!/^[a-z2-7]{32}$/.test(token)) return null;
  const id = sha256Hex(token);
  const rows = await db()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { session, user } = row;

  const idleMs = env().SESSION_IDLE_MINUTES * 60_000;
  const expired =
    now >= session.expiresAt ||
    user.status !== "active" ||
    (session.mfaVerifiedAt !== null && now.getTime() - session.lastSeenAt.getTime() > idleMs);
  if (expired) {
    await db().delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
    session.lastSeenAt = now;
  }
  if (Math.random() < 0.01) {
    db().delete(sessions).where(lt(sessions.expiresAt, now)).catch(() => {});
  }
  return { session, user };
}

export async function invalidateSession(sessionId: string, ex: Executor = db()): Promise<void> {
  await ex.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Logs a user out everywhere, optionally keeping the current session. */
export async function invalidateUserSessions(userId: string, ex: Executor = db(), exceptSessionId?: string) {
  await ex
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function countActiveSessions(userId: string): Promise<number> {
  const r = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from sessions where user_id = ${userId} and expires_at > now()`,
  );
  return r[0].n;
}
