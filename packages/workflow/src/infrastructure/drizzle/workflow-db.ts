import type { ResultSet } from "@libsql/client";
import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { applyWorkflowMigrations } from "./workflow-migrations.js";
import * as schema from "./workflow-schema.js";

/** The pkg's drizzle DB handle, parameterized by the workflow tables. */
export type Db = LibSQLDatabase<typeof schema>;

/**
 * Common query-capable handle — both {@link Db} and a drizzle transaction
 * satisfy this interface. Repositories accept `Tx` so they can participate
 * in a request-scoped transaction without owning one.
 */
export type Tx = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

/** Wrap an existing libsql client into a typed drizzle handle (no PRAGMAs, no migrations). */
export function wrapClient(client: Client): Db {
  return drizzle(client, { schema });
}

/**
 * Open the workflow DB (libsql) in WAL mode, apply migrations, and
 * return the drizzle handle plus `close`. The file is the per-workspace
 * `workspace.db`, shared with sibling packages via per-pkg migration
 * tables (`__drizzle_migrations_workflow`); each opens its own
 * connection. Tests pass `:memory:`.
 */
export async function openDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyWorkflowMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
