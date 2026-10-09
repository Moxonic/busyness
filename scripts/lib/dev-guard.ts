/** Stops development-only scripts from ever touching a non-local database. */
export function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    console.error(`Refusing to run: DATABASE_URL points at "${host}", not a local database.`);
    process.exit(1);
  }
}
