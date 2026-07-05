import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applySessionMigrations } from "./session-migrations.js";
import * as schema from "./session-schema.js";

/** The pkg's drizzle DB handle, parameterized by the session tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open the session DB in WAL mode, apply migrations, and return the
 * drizzle handle plus `close`. The file is the per-workspace
 * `workspace.db`, shared with sibling packages via per-pkg migration
 * tables; each opens its own connection.
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  try {
    applySessionMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, close: () => sqlite.close() };
}
