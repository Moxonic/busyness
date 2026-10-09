import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

const testEnv: Record<string, string> = { ...parse(readFileSync(".env.test")), NODE_ENV: "test" };
// CI provides its own database URLs.
for (const k of ["DATABASE_URL", "DATABASE_MIGRATION_URL"]) {
  if (process.env[`CI_${k}`]) testEnv[k] = process.env[`CI_${k}`]!;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    env: testEnv as NodeJS.ProcessEnv,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
