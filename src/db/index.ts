import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = Db | Tx;

const globalForDb = globalThis as unknown as { __db?: Db; __sql?: postgres.Sql };

function create(): Db {
  const sql = postgres(env().DATABASE_URL, {
    // Neon's pooled endpoint (PgBouncer, transaction mode) does not support prepared statements.
    prepare: false,
    max: env().DB_POOL_MAX,
    idle_timeout: 20,
    types: {
      // Keep NUMERIC as string so money never passes through a float.
      numeric: { to: 1700, from: [1700], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
  globalForDb.__sql = sql;
  return drizzle(sql, { schema });
}

/** Lazily created so that importing this module never needs a database (e.g. during `next build`). */
export function db(): Db {
  if (!globalForDb.__db) globalForDb.__db = create();
  return globalForDb.__db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__sql?.end({ timeout: 5 });
  globalForDb.__db = undefined;
  globalForDb.__sql = undefined;
}

export { schema };
