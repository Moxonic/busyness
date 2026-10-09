import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies schema migrations as the owner role, then (re)applies the privileges of the
 * restricted application role. Safe to run repeatedly.
 */
export async function migrateDatabase(ownerUrl: string, appRole: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error(`Invalid APP_DB_ROLE: ${appRole}`);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
    await applyGrants(sql, appRole);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function applyGrants(sql: postgres.Sql, appRole: string): Promise<void> {
  await sql.unsafe(`
    GRANT USAGE ON SCHEMA public TO ${appRole};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole};
    -- The audit log is append-only for the application.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${appRole};
    REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${appRole};
  `);
}
