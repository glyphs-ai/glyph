/**
 * Drizzle table definitions — the agent persistence schema, owned by the
 * adapter. No domain or application code imports this file.
 *
 * Tables describe a fully-installed agent:
 *   - `agents`                    : the entity row (metadata + ack/enabled)
 *   - `agent_files`               : the entry's file tree (anchor + sub-files)
 *   - `agent_skill_dependencies`  : skill-dep edges (source_fqn → target_fqn)
 *   - `agent_mcp_dependencies`    : mcp-dep edges (source_fqn → target_fqn)
 *   - `agent_agent_dependencies`  : agent-dep edges (source_fqn → target_fqn)
 *
 * `fqn` is the identity; `origin` is provenance. Each dep row is a
 * resolved edge: `source_fqn` is this agent, `target_fqn` the dependency.
 * Deps come from the manifest at install time.
 */

import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable(
  "agents",
  {
    fqn: text("fqn").primaryKey(),
    origin: text("origin").notNull(),
    description: text("description").notNull(),
    version: text("version").notNull(),
    prereqs: text("prereqs"),
    prereqsAck: integer("prereqs_ack").notNull().default(1),
    disabledByUser: integer("disabled_by_user").notNull().default(0),
    installedAt: text("installed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("agents_origin").on(t.origin), index("agents_updated_at").on(t.updatedAt)],
);

export const agentFiles = sqliteTable(
  "agent_files",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    agentFqn: text("agent_fqn").notNull(),
    relPath: text("rel_path").notNull(),
    content: blob("content", { mode: "buffer" }).notNull(),
  },
  (t) => [index("agent_files_agent_fqn_idx").on(t.agentFqn)],
);

export const agentSkillDeps = sqliteTable(
  "agent_skill_dependencies",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    sourceFqn: text("source_fqn").notNull(),
    targetFqn: text("target_fqn").notNull(),
  },
  (t) => [
    index("agent_skill_deps_src_idx").on(t.sourceFqn),
    index("agent_skill_deps_tgt_idx").on(t.targetFqn),
    uniqueIndex("agent_skill_deps_uniq").on(t.sourceFqn, t.targetFqn),
  ],
);

export const agentAgentDeps = sqliteTable(
  "agent_agent_dependencies",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    sourceFqn: text("source_fqn").notNull(),
    targetFqn: text("target_fqn").notNull(),
  },
  (t) => [
    index("agent_agent_deps_src_idx").on(t.sourceFqn),
    index("agent_agent_deps_tgt_idx").on(t.targetFqn),
    uniqueIndex("agent_agent_deps_uniq").on(t.sourceFqn, t.targetFqn),
  ],
);

export const agentMcpDeps = sqliteTable(
  "agent_mcp_dependencies",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    sourceFqn: text("source_fqn").notNull(),
    targetFqn: text("target_fqn").notNull(),
  },
  (t) => [
    index("agent_mcp_deps_src_idx").on(t.sourceFqn),
    index("agent_mcp_deps_tgt_idx").on(t.targetFqn),
    uniqueIndex("agent_mcp_deps_uniq").on(t.sourceFqn, t.targetFqn),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
export type AgentFileRow = typeof agentFiles.$inferInsert;
export type AgentSkillDepRow = typeof agentSkillDeps.$inferInsert;
export type AgentMcpDepRow = typeof agentMcpDeps.$inferInsert;
export type AgentAgentDepRow = typeof agentAgentDeps.$inferInsert;
