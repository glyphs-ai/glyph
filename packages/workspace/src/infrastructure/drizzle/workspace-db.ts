import type { ResultSet } from "@libsql/client";
import { type BaseSQLiteDatabase, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Workspace registry table; rows are mapped to `WorkspaceEntity`. */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  workspaceDir: text("workspace_dir").notNull().unique(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  lastOpenedAt: text("last_opened_at"),
});

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;

/**
 * The pkg's drizzle DB handle, parameterized by the workspace table above.
 * A request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof import("./workspace-db.js")>;
