import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applyScheduleMigrations } from "./schedule-migrations.js";
import * as schema from "./schedule-schema.js";

/** The pkg's drizzle DB handle, parameterized by the schedules table. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open the schedule DB in WAL mode, apply migrations, and return the drizzle
 * handle plus `close`. The file is the per-workspace `workspace.db`, shared
 * with sibling packages via per-pkg migration tables
 * (`__drizzle_migrations_schedule`); each opens its own connection. Tests
 * pass `:memory:`.
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  // Migration failure must close the SQLite handle before propagating: a
  // leaked handle would hold the WAL lock and break a subsequent retry from
  // the same caller (EBUSY until process exit).
  try {
    applyScheduleMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, close: () => sqlite.close() };
}
