// Emergency: reset two-factor login for a user (e.g. the only owner lost phone and recovery codes).
// Usage: npm run user:reset-mfa -- user@example.com
import "./lib/load-env";
import { closeDb } from "@/db";
import { findUserByEmail } from "@/server/auth/service";
import { resetUserMfa } from "@/server/users/service";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run user:reset-mfa -- user@example.com");
  process.exit(1);
}
const user = await findUserByEmail(email);
if (!user) {
  console.error("No such user.");
  await closeDb();
  process.exit(1);
}
const r = await resetUserMfa({ actorId: null, actorLabel: "cli:reset-mfa" }, user.id, true);
await closeDb();
console.log(r.ok ? `Two-factor login reset for ${email}. They set it up again at next login.` : `Failed: ${r.error}`);
