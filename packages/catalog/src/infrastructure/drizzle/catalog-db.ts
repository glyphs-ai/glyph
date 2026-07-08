/**
 * Persistence barrel + `Db` type for the catalog package.
 *
 * Re-exports the per-aggregate table definitions and their `Row` / `NewRow`
 * types so one drizzle handle is parameterized over every catalog table and
 * `drizzle-kit` reads a single schema entrypoint. Also exposes the pkg's
 * drizzle `Db` handle type, which is fully determined by the tables below
 * (a request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one).
 *
 * No domain or application code imports the raw table modules directly;
 * everything comes through this file.
 */

import type { ResultSet } from "@libsql/client";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export * from "./agent-schema.js";
export * from "./mcp-schema.js";
export * from "./skill-schema.js";

export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof import("./catalog-db.js")>;
