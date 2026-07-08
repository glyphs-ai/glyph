import type { ResultSet } from "@libsql/client";
import { type BaseSQLiteDatabase, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Table for the __Entity__ aggregate; rows map to `__Entity__Entity`. */
export const __entities__ = sqliteTable("__entities__", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull(),
});

export type __Entity__Row = typeof __entities__.$inferSelect;
export type New__Entity__Row = typeof __entities__.$inferInsert;

/**
 * The pkg's drizzle DB handle, parameterized by the __PKG__ tables above.
 * A request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof import("./__entity-kebab__-db.js")>;
