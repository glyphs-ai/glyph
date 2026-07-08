import type { ResultSet } from "@libsql/client";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./catalog-schema.js";

/**
 * The pkg's drizzle DB handle, parameterized by the catalog tables. A
 * request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof schema>;

/**
 * Re-exported here so hosts can apply this package's migrations against the
 * shared libsql client they build in `packages/api/src/workspace-context.ts`.
 */
export { applyCatalogMigrations } from "./catalog-migrations.js";
