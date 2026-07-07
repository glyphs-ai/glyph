import type { ResultSet } from "@libsql/client";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { applyCatalogMigrations } from "./catalog-migrations.js";
import * as schema from "./catalog-schema.js";

/**
 * The pkg's drizzle DB handle, parameterized by the catalog tables. A
 * request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

/** Wrap an existing libsql client into a typed drizzle handle (no PRAGMAs, no migrations). */
export function wrapClient(client: Client): Db {
  return drizzle(client, { schema });
}

/**
 * Open a libsql connection in WAL mode, run pending migrations, and
 * return the drizzle handle plus `close`. Tests pass `":memory:"` (as a
 * `file::memory:` URL); production passes `file:<absolute-path>`.
 *
 * On migration failure the client is closed before the error propagates:
 * a leaked handle would hold the WAL lock and break a subsequent retry
 * from the same caller.
 */
export async function openDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyCatalogMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
