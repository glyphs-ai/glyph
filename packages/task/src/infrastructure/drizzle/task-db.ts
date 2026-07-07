import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { applyTaskMigrations } from "./task-migrations.js";
import * as schema from "./task-schema.js";

/** The pkg's drizzle DB handle, parameterized by the task tables. */
export type Db = LibSQLDatabase<typeof schema>;

/**
 * Open the task DB (libsql) in WAL mode, apply migrations, and return
 * the drizzle handle plus `close`. The file is the per-workspace
 * `workspace.db`, shared with sibling packages via per-pkg migration
 * tables (`__drizzle_migrations_task`); each opens its own connection.
 * Tests pass `:memory:`.
 */
export async function openDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client: Client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyTaskMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
