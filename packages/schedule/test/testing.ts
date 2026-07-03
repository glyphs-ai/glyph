import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { type Db, openDb } from "../src/infrastructure/drizzle/schedule-db.js";

/**
 * Open an in-memory schedule DB for tests, reusing the production `openDb`
 * (WAL pragmas + migrations) so the test schema can't drift from production.
 * Also surfaces the raw better-sqlite3 handle (`db.$client`) for the few
 * migration/query-plan tests that issue raw SQL. Caller closes via `.close()`.
 */
export function openTestScheduleDb(): {
  db: Db;
  sqlite: BetterSqliteDatabase;
  close(): void;
} {
  const { db, close } = openDb(":memory:");
  // `openDb` types its handle as `Db` (bare `BetterSQLite3Database`), which
  // drops drizzle's `$client` accessor from the type. The underlying
  // better-sqlite3 connection is present at runtime; reach it for raw SQL.
  const sqlite = (db as unknown as { $client: BetterSqliteDatabase }).$client;
  return { db, sqlite, close };
}
