/**
 * Drizzle table definitions — the persistence schema, owned by the
 * adapter. No domain or application code imports this file.
 *
 * Three tables describe a fully-installed agent:
 *   - `agents`        : the entity row (id + metadata + state)
 *   - `agent_skills`  : many-to-many for attached skills
 *   - `agent_files`   : the entry's file tree (anchor + sub-files),
 *                       cascade-deleted with the agent
 *
 * Naming aligns with the existing catalog convention:
 *   - `rel_path` for the POSIX-style file path
 *   - `content` for the byte blob (Buffer mode for binary safety)
 *   - the anchor file (AGENTS.md) is stored as one row in
 *     `agent_files` — no separate "anchor" column
 */

import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default("0.0.0"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const agentSkills = sqliteTable(
  "agent_skills",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.skillId] })],
);

export const agentFiles = sqliteTable(
  "agent_files",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    content: blob("content", { mode: "buffer" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.relPath] })],
);
