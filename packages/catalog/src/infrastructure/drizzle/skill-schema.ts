/**
 * Drizzle table definitions — the skill persistence schema, owned by the
 * adapter. No domain or application code imports this file.
 *
 * Four tables describe a fully-installed skill:
 *   - `skills`                    : the entity row (metadata + prereq-ack state)
 *   - `skill_files`               : the entry's file tree (SKILL.md + sub-files)
 *   - `skill_skill_dependencies`  : skill-dep edges (source_fqn → target_fqn)
 *   - `skill_mcp_dependencies`    : mcp-dep edges (source_fqn → target_fqn)
 *
 * `fqn` is the identity; `origin` is provenance. Each dep row is a
 * resolved edge: `source_fqn` is this skill, `target_fqn` the dependency.
 */

import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const skills = sqliteTable(
  "skills",
  {
    fqn: text("fqn").primaryKey(),
    origin: text("origin").notNull(),
    description: text("description").notNull(),
    version: text("version").notNull(),
    prereqs: text("prereqs"),
    prereqsAck: integer("prereqs_ack").notNull().default(1),
    installedAt: text("installed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("skills_origin").on(t.origin), index("skills_updated_at").on(t.updatedAt)],
);

export const skillFiles = sqliteTable(
  "skill_files",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    skillFqn: text("skill_fqn").notNull(),
    relPath: text("rel_path").notNull(),
    content: blob("content", { mode: "buffer" }).notNull(),
  },
  (t) => [index("skill_files_skill_fqn_idx").on(t.skillFqn)],
);

export const skillSkillDeps = sqliteTable(
  "skill_skill_dependencies",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    sourceFqn: text("source_fqn").notNull(),
    targetFqn: text("target_fqn").notNull(),
  },
  (t) => [
    index("skill_skill_deps_src_idx").on(t.sourceFqn),
    index("skill_skill_deps_tgt_idx").on(t.targetFqn),
    uniqueIndex("skill_skill_deps_uniq").on(t.sourceFqn, t.targetFqn),
  ],
);

export const skillMcpDeps = sqliteTable(
  "skill_mcp_dependencies",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    sourceFqn: text("source_fqn").notNull(),
    targetFqn: text("target_fqn").notNull(),
  },
  (t) => [
    index("skill_mcp_deps_src_idx").on(t.sourceFqn),
    index("skill_mcp_deps_tgt_idx").on(t.targetFqn),
    uniqueIndex("skill_mcp_deps_uniq").on(t.sourceFqn, t.targetFqn),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;
export type SkillFileRow = typeof skillFiles.$inferInsert;
export type SkillSkillDepRow = typeof skillSkillDeps.$inferInsert;
export type SkillMcpDepRow = typeof skillMcpDeps.$inferInsert;
