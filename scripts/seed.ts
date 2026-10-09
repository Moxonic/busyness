// Fills the LOCAL database with a fictional test company and three users, one per role.
// Usage: npm run seed   (then: npm run dev:totp -- eier@fjordlys.test  to get a login code)
import "./lib/load-env";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { company, files, recoveryCodes, users } from "@/db/schema";
import { withAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { storeFile } from "@/lib/storage";
import { generateRecoveryCodes, hashRecoveryCode, newTotpKey, totpManualKey } from "@/lib/totp";
import { assertLocalDatabase } from "./lib/dev-guard";

assertLocalDatabase();

export const SEED_PASSWORD = "Fjordlys-test-2026";
const people = [
  { email: "eier@fjordlys.test", name: "Ola Testeier", role: "owner" as const },
  { email: "ansatt@fjordlys.test", name: "Kari Ansatt", role: "employee" as const },
  { email: "regnskap@fjordlys.test", name: "Rita Regnskapsfører", role: "accountant" as const },
];

const ctx = { actorId: null, actorLabel: "seed" };
const passwordHash = await hashPassword(SEED_PASSWORD);

await withAudit(ctx, async (tx) => {
  await tx
    .update(company)
    .set({
      name: "Fjordlys Testfirma AS",
      orgNumber: "999999999", // fictional; passes the MOD11 check
      legalForm: "AS",
      addressLine: "Testveien 1",
      postalCode: "0150",
      city: "Oslo",
      email: "post@fjordlys.test",
      phone: "+47 22 00 00 00",
      updatedAt: new Date(),
    })
    .where(eq(company.id, 1));
});

console.log("\nFictional test company: Fjordlys Testfirma AS\n");
for (const p of people) {
  const existing = await db().query.users.findFirst({ where: eq(users.email, p.email) });
  if (existing) {
    console.log(`  ${p.email} already exists, skipped`);
    continue;
  }
  const key = newTotpKey();
  const codes = generateRecoveryCodes();
  await withAudit(ctx, async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        ...p,
        passwordHash,
        passwordChangedAt: new Date(),
        totpSecretEnc: encryptSecret(key),
        totpEnabledAt: new Date(),
      })
      .returning();
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: u.id, codeHash: hashRecoveryCode(c) })));
  });
  console.log(`  ${p.role.padEnd(10)} ${p.email}`);
  console.log(`             authenticator key: ${totpManualKey(key)}   first recovery code: ${codes[0]}`);
}
if ((await db().select().from(files).limit(1)).length === 0) {
  for (const name of ["kvittering-kontorrekvisita.txt", "faktura-strom-mars.txt"]) {
    const bytes = new TextEncoder().encode(`Fiktivt testbilag: ${name}\n`);
    await storeFile(ctx, { name, contentType: "text/plain", bytes });
  }
  console.log("\n  2 sample documents stored");
}
console.log(`\nPassword for all test users: ${SEED_PASSWORD}`);
console.log("Login code without a phone:  npm run dev:totp -- eier@fjordlys.test\n");
await closeDb();
