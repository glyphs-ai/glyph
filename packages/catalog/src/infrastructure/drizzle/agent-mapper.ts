/**
 * Row ↔ Agent mapper. Repository delegates all shape translation here so
 * the repository reads as pure persistence orchestration. `toDomain`
 * builds via the trusted `new AgentEntity({...})` door (a persisted row
 * was valid on the way in). `toRow` / `toFileRows` / `to*DepRows` flatten
 * the aggregate. `fqn` casts to `AgentFqn` — the trusted-source door.
 * `disabledByUser` and `prereqsAck` are stored verbatim.
 */

import { AgentEntity } from "../../domain/agent-entity.js";
import type { AgentFqn } from "../../domain/agent-fqn.js";
import type {
  agentAgentDeps,
  agentFiles,
  agentMcpDeps,
  agentSkillDeps,
  agents,
} from "./agent-schema.js";

export type AgentRow = typeof agents.$inferSelect;
export type AgentFileRow = typeof agentFiles.$inferInsert;
export type AgentDepRow = typeof agentSkillDeps.$inferInsert;

export const AgentMapper = {
  toDomain(
    row: AgentRow,
    skillDeps: readonly AgentDepRow[],
    mcpDeps: readonly AgentDepRow[],
    agentDeps: readonly AgentDepRow[],
  ): AgentEntity {
    return new AgentEntity({
      fqn: row.fqn as AgentFqn,
      origin: row.origin,
      description: row.description,
      version: row.version,
      prereqs: row.prereqs ?? undefined,
      prereqsAck: row.prereqsAck === 1,
      disabledByUser: row.disabledByUser === 1,
      dependencyRefs: {
        skills: skillDeps.map((d) => d.targetFqn),
        mcps: mcpDeps.map((d) => d.targetFqn),
        agents: agentDeps.map((d) => d.targetFqn),
      },
      installedAt: row.installedAt,
      updatedAt: row.updatedAt,
    });
  },

  toRow(agent: AgentEntity): AgentRow {
    return {
      fqn: agent.id,
      origin: agent.origin,
      description: agent.description,
      version: agent.version,
      prereqs: agent.prereqs ?? null,
      prereqsAck: agent.prereqsAck ? 1 : 0,
      disabledByUser: agent.disabledByUser ? 1 : 0,
      installedAt: agent.installedAt,
      updatedAt: agent.updatedAt,
    };
  },

  toFileRows(agent: AgentEntity, files: ReadonlyMap<string, Buffer>): AgentFileRow[] {
    return [...files].map(([relPath, content]) => ({ agentFqn: agent.id, relPath, content }));
  },

  toSkillDepRows(agent: AgentEntity): AgentDepRow[] {
    return agent.dependencyRefs.skills.map((targetFqn) => ({ sourceFqn: agent.id, targetFqn }));
  },

  toMcpDepRows(agent: AgentEntity): (typeof agentMcpDeps.$inferInsert)[] {
    return agent.dependencyRefs.mcps.map((targetFqn) => ({ sourceFqn: agent.id, targetFqn }));
  },

  toAgentDepRows(agent: AgentEntity): (typeof agentAgentDeps.$inferInsert)[] {
    return agent.dependencyRefs.agents.map((targetFqn) => ({ sourceFqn: agent.id, targetFqn }));
  },
} as const;
