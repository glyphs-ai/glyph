/**
 * Row ↔ Agent mapper. Repository delegates all shape translation here
 * so the repository code reads like pure persistence orchestration
 * (queries + transactions) without inline `new AgentEntity(...)`.
 *
 * Row types are derived via Drizzle's `$inferSelect` — the schema is
 * the single source of truth and the TS types can never drift from the
 * actual column definitions.
 *
 * `toDomain` calls `AgentEntity.fromState` (rehydration entry point;
 * skips creation invariants). `toRow` / `toSkillRows` / `toFileRows`
 * flatten the aggregate into the three table shapes.
 */

import { AgentEntity, type AgentId, type SkillId } from "../../domain/agent-entity.js";
import type { agentFiles, agentSkills, agents } from "./agent-schema.js";

export type AgentRow = typeof agents.$inferSelect;
export type SkillAttachmentRow = typeof agentSkills.$inferSelect;
export type AgentFileRow = typeof agentFiles.$inferSelect;

export const AgentMapper = {
  toDomain(row: AgentRow, skillRows: readonly SkillAttachmentRow[]): AgentEntity {
    return AgentEntity.fromState({
      id: row.id as AgentId,
      name: row.name,
      description: row.description,
      version: row.version,
      enabled: row.enabled,
      skills: skillRows.map((r) => r.skillId as SkillId),
    });
  },

  toRow(agent: AgentEntity): AgentRow {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      version: agent.version,
      enabled: agent.enabled,
    };
  },

  toSkillRows(agent: AgentEntity): SkillAttachmentRow[] {
    return agent.skills.map((s) => ({ agentId: agent.id, skillId: s }));
  },

  toFileRows(agent: AgentEntity, files: ReadonlyMap<string, Buffer>): AgentFileRow[] {
    const out: AgentFileRow[] = [];
    for (const [relPath, content] of files) {
      out.push({ agentId: agent.id, relPath, content });
    }
    return out;
  },
} as const;
