import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Table for the __Entity__ aggregate; rows map to `__Entity__Entity`. */
export const __entities__ = sqliteTable("__entities__", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull(),
});
