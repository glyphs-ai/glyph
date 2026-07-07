import type { ResultSet } from "@libsql/client";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { applySessionMigrations } from "./session-migrations.js";
import * as schema from "./session-schema.js";

/**
 * The pkg's drizzle DB handle, parameterized by the session tables. A
 * request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

/**
 * Open the session DB (libsql) in WAL mode, apply migrations, and return
 * the drizzle handle plus `close`. The file is the per-workspace
 * `workspace.db`, shared with sibling packages via per-pkg migration
 * tables; each opens its own connection.
 */
export async function openDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applySessionMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
