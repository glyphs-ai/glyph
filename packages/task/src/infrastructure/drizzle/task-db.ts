import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applyTaskMigrations } from "./task-migrations.js";
import * as schema from "./task-schema.js";

/** The pkg's drizzle DB handle, parameterized by the task tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open the task DB in WAL mode, apply migrations, and return the drizzle
 * handle plus `close`. The file is the per-workspace `workspace.db`, shared
 * with sibling packages via per-pkg migration tables (`__drizzle_migrations_task`);
 * each opens its own connection. Tests pass `:memory:`.
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  // No `foreign_keys = ON`: the schema has no FK constraints, so the pragma
  // would be a no-op that misleads readers.
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  // Migration failure must close the SQLite handle before propagating: a
  // leaked handle would hold the WAL lock and break a subsequent retry from
  // the same caller (EBUSY until process exit).
  try {
    applyTaskMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, close: () => sqlite.close() };
}
