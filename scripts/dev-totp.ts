// LOCAL DEVELOPMENT ONLY: prints the current authenticator code for a user, so you can try
// logging in without setting up a phone. Refuses to run against a non-local database.
import "./lib/load-env";
import { generateTOTP } from "@oslojs/otp";
import { closeDb } from "@/db";
import { decryptSecret } from "@/lib/crypto";
import { findUserByEmail } from "@/server/auth/service";
import { assertLocalDatabase } from "./lib/dev-guard";

assertLocalDatabase();
const user = await findUserByEmail(process.argv[2] ?? "");
await closeDb();
if (!user?.totpSecretEnc) {
  console.error("Unknown user or no authenticator set up.");
  process.exit(1);
}
const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${generateTOTP(decryptSecret(user.totpSecretEnc), 30, 6)}  (valid ~${secondsLeft}s more)`);
