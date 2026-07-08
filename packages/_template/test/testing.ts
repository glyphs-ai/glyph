import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { apply__Entity__Migrations } from "../src/infrastructure/drizzle/__entity-kebab__-migrations.js";
import * as schema from "../src/infrastructure/drizzle/__entity-kebab__-schema.js";

/**
 * Test-only DB opener. Applies PRAGMAs + migrations against a fresh
 * `:memory:` or file-backed SQLite client. Production callers build their
 * client + drizzle handle in the host (see
 * `packages/api/src/workspace-context.ts`) and pass it to
 * `compose__Entity__Module({ db })`; production PRAGMAs are set once against
 * the shared client there.
 */
export function openTestDb(dbFile: string): { db: Db; close(): void } {
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
