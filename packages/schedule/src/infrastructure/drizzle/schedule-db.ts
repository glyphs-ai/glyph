import type { ResultSet } from "@libsql/client";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { applyScheduleMigrations } from "./schedule-migrations.js";
import * as schema from "./schedule-schema.js";

/**
 * The pkg's drizzle DB handle, parameterized by the schedules table. A
 * request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

/** Wrap an existing libsql client into a typed drizzle handle (no PRAGMAs, no migrations). */
export function wrapClient(client: Client): Db {
  return drizzle(client, { schema });
}

/**
 * Open the schedule DB (libsql) in WAL mode, apply migrations, and
 * return the drizzle handle plus `close`. The file is the per-workspace
 * `workspace.db`, shared with sibling packages via per-pkg migration
 * tables (`__drizzle_migrations_schedule`); each opens its own
 * connection. Tests pass `:memory:`.
 */
export async function openDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyScheduleMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
