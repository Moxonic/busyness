import "./lib/load-env";
import { migrateDatabase } from "./lib/migrate-db";

const url = process.env.DATABASE_MIGRATION_URL;
const role = process.env.APP_DB_ROLE ?? "busyness_app";
if (!url) {
  console.error("DATABASE_MIGRATION_URL is not set.");
  process.exit(1);
}

await migrateDatabase(url, role);
console.log("Migrations applied and privileges for", role, "updated.");
