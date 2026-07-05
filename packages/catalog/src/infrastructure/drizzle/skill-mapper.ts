/**
 * Row ↔ Skill mapper. The repository delegates shape translation here so
 * it reads as pure persistence orchestration. The mapper is drizzle-only
 * and has no manifest knowledge. `toDomain` rehydrates from the entity row
 * and dep edge rows; `toRow`/`toFileRows`/`toDepRows` flatten the aggregate.
 * `fqn` casts to `SkillFqn` from trusted persisted rows.
 */

import { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillFqn } from "../../domain/skill-fqn.js";
import type { skillFiles, skillMcpDeps, skillSkillDeps, skills } from "./skill-schema.js";

export type SkillRow = typeof skills.$inferSelect;
export type SkillFileRow = typeof skillFiles.$inferInsert;
export type SkillDepRow = typeof skillSkillDeps.$inferInsert;

export const SkillMapper = {
  toDomain(
    row: SkillRow,
    skillDeps: readonly SkillDepRow[],
    mcpDeps: readonly (typeof skillMcpDeps.$inferInsert)[],
  ): SkillEntity {
    return new SkillEntity({
      fqn: row.fqn as SkillFqn,
      origin: row.origin,
      description: row.description,
      version: row.version,
      prereqs: row.prereqs ?? undefined,
      prereqsAck: row.prereqsAck === 1,
      dependencyRefs: {
        skills: skillDeps.map((d) => d.targetFqn),
        mcps: mcpDeps.map((d) => d.targetFqn),
      },
      installedAt: row.installedAt,
      updatedAt: row.updatedAt,
    });
  },

  toRow(skill: SkillEntity): SkillRow {
    return {
      fqn: skill.id,
      origin: skill.origin,
      description: skill.description,
      version: skill.version,
      prereqs: skill.prereqs ?? null,
      prereqsAck: skill.prereqsAck ? 1 : 0,
      installedAt: skill.installedAt,
      updatedAt: skill.updatedAt,
    };
  },

  toFileRows(skill: SkillEntity, files: ReadonlyMap<string, Buffer>): SkillFileRow[] {
    return [...files].map(([relPath, content]) => ({ skillFqn: skill.id, relPath, content }));
  },

  toSkillDepRows(skill: SkillEntity): SkillDepRow[] {
    return skill.dependencyRefs.skills.map((targetFqn) => ({ sourceFqn: skill.id, targetFqn }));
  },

  toMcpDepRows(skill: SkillEntity): (typeof skillMcpDeps.$inferInsert)[] {
    return skill.dependencyRefs.mcps.map((targetFqn) => ({ sourceFqn: skill.id, targetFqn }));
  },
} as const;
