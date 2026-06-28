import { openDb } from "../../src/persistence/catalog.db.js";

/**
 * Bootstrap helper for catalog tests. Opens an in-memory Drizzle
 * (better-sqlite3) instance with the catalog schema pre-applied.
 * Callers should call `handle.close()` in afterEach.
 */
export function bootstrapCatalogDb(): ReturnType<typeof openDb> {
  return openDb(":memory:");
}
