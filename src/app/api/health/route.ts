import { sql } from "drizzle-orm";
import { db } from "@/db";

/** For uptime monitoring. Reveals nothing except whether the app can reach its database. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
