import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limiting stored in Postgres. Netlify functions share no memory,
 * so the database is the only place every instance sees the same counters.
 */
export type Limit = { limit: number; windowSec: number };
export type LimitResult = { allowed: boolean; retryAfterSec: number };

export const LIMITS = {
  /** All login attempts from one IP address. */
  loginIp: { limit: 30, windowSec: 15 * 60 },
  /** Failed logins for one account. Reset after a successful login. */
  loginAccount: { limit: 8, windowSec: 15 * 60 },
  /** Failed second-factor codes for one user. */
  mfaUser: { limit: 6, windowSec: 15 * 60 },
  resetEmail: { limit: 3, windowSec: 60 * 60 },
  resetIp: { limit: 10, windowSec: 60 * 60 },
  inviteIp: { limit: 20, windowSec: 15 * 60 },
} satisfies Record<string, Limit>;

/** Counts one attempt and says whether it is within the limit. */
export async function consume(key: string, l: Limit): Promise<LimitResult> {
  const window = sql`(${l.windowSec}::int * interval '1 second')`;
  const rows = await db().execute<{ count: number; retry: number }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - ${window} then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - ${window} then now() else rate_limits.window_start end
    returning count, ceil(extract(epoch from (window_start + ${window} - now())))::int as retry`);
  maybeCleanup();
  const { count, retry } = rows[0];
  return { allowed: count <= l.limit, retryAfterSec: Math.max(1, retry) };
}

/** Checks whether the limit is already reached, without counting an attempt. */
export async function peek(key: string, l: Limit): Promise<LimitResult> {
  const rows = await db().execute<{ count: number; retry: number }>(sql`
    select count, ceil(extract(epoch from (window_start + (${l.windowSec}::int * interval '1 second') - now())))::int as retry
    from rate_limits where key = ${key}`);
  const r = rows[0];
  if (!r || r.retry <= 0) return { allowed: true, retryAfterSec: 0 };
  return { allowed: r.count < l.limit, retryAfterSec: r.retry };
}

export async function resetLimit(key: string): Promise<void> {
  await db().delete(rateLimits).where(eq(rateLimits.key, key));
}

function maybeCleanup() {
  if (Math.random() < 0.02) {
    db()
      .execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`)
      .catch(() => {});
  }
}
