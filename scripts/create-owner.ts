// Creates an invitation for the first owner and prints the link.
// Usage: npm run create-owner -- you@example.com [--force]
import "./lib/load-env";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { users } from "@/db/schema";
import { createInvitation } from "@/server/auth/service";

const email = process.argv[2];
const force = process.argv.includes("--force");
if (!email || !email.includes("@")) {
  console.error("Usage: npm run create-owner -- you@example.com");
  process.exit(1);
}

const owners = await db().select().from(users).where(and(eq(users.role, "owner"), eq(users.status, "active")));
if (owners.length > 0 && !force) {
  console.error(`An active owner already exists (${owners.map((o) => o.email).join(", ")}).`);
  console.error("Invite more people from the Users page, or re-run with --force.");
  await closeDb();
  process.exit(1);
}

const r = await createInvitation({ actorId: null, actorLabel: "cli:create-owner" }, { email, role: "owner", inviterName: "Busyness" });
await closeDb();
if (!r.ok) {
  console.error("A user with that email already exists.");
  process.exit(1);
}
console.log(`\nInvitation for ${email} (owner). Valid for 7 days, works once:\n\n  ${r.link}\n`);
