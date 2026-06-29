import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applyWorkspaceMigrations } from "./workspace-migrations.js";
import * as schema from "./workspace-schema.js";

/** The pkg's drizzle DB handle, parameterized by the workspace tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open a better-sqlite3 connection in WAL mode, run pending migrations,
 * and return the drizzle handle plus a `close`. Tests pass `":memory:"`;
 * production passes the absolute path to `global.db`.
 *
 * On migration failure the SQLite handle is closed before the error
 * propagates: a leaked handle would hold the WAL lock and break a
 * subsequent retry from the same caller (EBUSY on the lockfile / WAL
 * files until process exit).
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  // No `foreign_keys = ON` — schema has no FK constraints; the pragma
  // without FKs is a no-op and would mislead readers.
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  try {
    applyWorkspaceMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, close: () => sqlite.close() };
}
