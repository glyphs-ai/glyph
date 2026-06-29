import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { apply__Entity__Migrations } from "./__entity-kebab__-migrations.js";
import * as schema from "./__entity-kebab__-schema.js";

/** The pkg's drizzle DB handle, parameterized by the __PKG__ tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open the SQLite DB in WAL mode, apply migrations, and return the
 * drizzle handle plus `close`.
 */
export function openDb(dbFile: string): { db: Db; close(): void } {
  const sqlite: BetterSqliteDatabase = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  try {
    apply__Entity__Migrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, close: () => sqlite.close() };
}
