import postgres from "postgres";
import { migrateDatabase } from "../scripts/lib/migrate-db";
import { closeDb } from "@/db";
import { company, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { newTotpKey } from "@/lib/totp";
import { E2E_PASSWORD, E2E_USERS } from "./helpers";

/** Fresh test database with one user per role. */
export default async function globalSetup() {
  const ownerUrl = process.env.DATABASE_MIGRATION_URL!;
  if (!/busyness_test|\/test/.test(ownerUrl)) throw new Error(`Not a test database: ${ownerUrl}`);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await sql.end();
  await migrateDatabase(ownerUrl, process.env.APP_DB_ROLE!);

  const ctx = { actorId: null, actorLabel: "e2e-setup" };
  const passwordHash = await hashPassword(E2E_PASSWORD);
  await withAudit(ctx, async (tx) => {
    await tx.update(company).set({ name: "E2E Testfirma AS" }).where(eq(company.id, 1));
    for (const u of Object.values(E2E_USERS)) {
      await tx.insert(users).values({
        ...u,
        passwordHash,
        totpSecretEnc: encryptSecret(newTotpKey()),
        totpEnabledAt: new Date(),
      });
    }
  });
  await closeDb();
}
