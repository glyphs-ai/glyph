import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applyWorkspaceMigrations } from "./workspace-migrations.js";
import * as schema from "./workspace-schema.js";

/** The pkg's drizzle DB handle, parameterized by the workspace tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open the workspace SQLite DB in WAL mode, apply migrations, and
 * return the drizzle handle plus `close`.
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  // No foreign-key constraints exist in this schema.
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
