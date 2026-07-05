import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Workspace registry table; rows are mapped to `WorkspaceEntity`. */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  workspaceDir: text("workspace_dir").notNull().unique(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  lastOpenedAt: text("last_opened_at"),
});
