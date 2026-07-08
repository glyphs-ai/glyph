import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./__entity-kebab__-schema.js";

/** The pkg's drizzle DB handle, parameterized by the __PKG__ tables. */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Re-exported here so hosts can apply this package's migrations against the
 * SQLite client they build (see `packages/api/src/workspace-context.ts`).
 */
export { apply__Entity__Migrations } from "./__entity-kebab__-migrations.js";
