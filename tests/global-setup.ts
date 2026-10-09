import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import postgres from "postgres";
import { migrateDatabase } from "../scripts/lib/migrate-db";

/** Rebuilds the test database from the migrations before every run. */
export default async function setup() {
  const fileEnv = parse(readFileSync(".env.test"));
  const ownerUrl = process.env.CI_DATABASE_MIGRATION_URL ?? fileEnv.DATABASE_MIGRATION_URL;
  const role = fileEnv.APP_DB_ROLE;
  if (!/busyness_test|\/test/.test(ownerUrl)) {
    throw new Error(`Refusing to wipe a database that does not look like a test database: ${ownerUrl}`);
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);
  await sql.end();
  await migrateDatabase(ownerUrl, role);
}
