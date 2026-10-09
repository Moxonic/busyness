// Loads .env.local (or the file in ENV_FILE) for command-line scripts. Real environment variables win.
import { existsSync } from "node:fs";
import { config } from "dotenv";

const file = process.env.ENV_FILE ?? ".env.local";
if (existsSync(file)) config({ path: file, quiet: true });
