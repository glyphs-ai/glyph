import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Workspace registry table. Pure Drizzle schema — no class, no
 * decorators, no entity ceremony. The row shape stays private to this
 * layer: the repository maps it to/from the domain `WorkspaceEntity`
 * (`domain/workspace.entity.ts`), and the public wire DTO is `Workspace`
 * (`contract/workspace.types.ts`).
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  workspaceDir: text("workspace_dir").notNull().unique(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  lastOpenedAt: text("last_opened_at"),
});
