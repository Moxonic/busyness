import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { parse } from "dotenv";

// End-to-end tests run a dev server against the *test* database and send email to Mailpit.
// Requires: docker compose up -d db mail
const PORT = 3100;
const e2eEnv: Record<string, string> = {
  ...parse(readFileSync(".env.test")),
  APP_URL: `http://localhost:${PORT}`,
  MAIL_TRANSPORT: "smtp",
  SMTP_URL: "smtp://localhost:1025",
  STORAGE_LOCAL_DIR: ".data/e2e-files",
};
for (const k of ["DATABASE_URL", "DATABASE_MIGRATION_URL"]) {
  if (process.env[`CI_${k}`]) e2eEnv[k] = process.env[`CI_${k}`]!;
}
Object.assign(process.env, e2eEnv);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "nb-NO",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    env: e2eEnv,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
