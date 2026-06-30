import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AgentEntity } from "../../domain/agent-entity.js";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import type { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

const AgentDependenciesSchema = z
  .object({
    skills: z.array(DependencyRefSchema).optional(),
    mcps: z.array(DependencyRefSchema).optional(),
    agents: z.array(DependencyRefSchema).optional(),
  })
  .optional();

const AgentSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  disabledByUser: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: AgentDependenciesSchema,
});
const MissingDepSchema = z.object({
  kind: z.enum(["skill", "mcp"]),
  name: z.string(),
});
type MissingDep = z.infer<typeof MissingDepSchema>;

const BlockedDepSchema = z.object({
  kind: z.enum(["skill", "mcp"]),
  fqn: z.string(),
});
type BlockedDep = z.infer<typeof BlockedDepSchema>;

const BlockedReasonSchema = z.object({
  needsPrereqsAck: z.literal(true).optional(),
  disabledByUser: z.literal(true).optional(),
  orphaned: z.literal(true).optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
  blockedDeps: z.array(BlockedDepSchema).optional(),
});
type BlockedReason = z.infer<typeof BlockedReasonSchema>;

interface ComputedStatus {
  readonly status: "ready" | "blocked";
  readonly reason?: BlockedReason;
}
export const ListAgentEntriesRequestSchema = z.object({});
export type ListAgentEntriesRequest = z.infer<typeof ListAgentEntriesRequestSchema>;
const ListAgentEntriesSchema = z.object({
  agent: AgentSchema,
  status: z.enum(["ready", "blocked"]),
  blockedReason: BlockedReasonSchema.optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
  coordEligible: z.boolean(),
});
export const ListAgentEntriesResponseSchema = z.array(ListAgentEntriesSchema);
export type ListAgentEntriesResponse = z.infer<typeof ListAgentEntriesResponseSchema>;
export type ListAgentEntriesError = DatabaseUnavailable;
export interface ListAgentEntriesDeps {
  readonly agentRepo: AgentRepository;
  readonly skillRepo: SkillRepository;
  readonly mcpRepo: McpRepository;
}

export class ListAgentEntriesUseCase
  implements UseCase<ListAgentEntriesRequest, ListAgentEntriesResponse, ListAgentEntriesError>
{
  constructor(private readonly deps: ListAgentEntriesDeps) {}

  execute(
    _request: ListAgentEntriesRequest,
  ): UseCaseResult<ListAgentEntriesResponse, ListAgentEntriesError> {
    return ResultAsync.combine([
      this.deps.skillRepo.list(),
      this.deps.agentRepo.list(),
      this.deps.mcpRepo.list(),
    ]).map(([skills, agents, mcps]) => {
      const referencedSkillFqns = new Set<string>();
      const referencedMcpFqns = new Set<string>();
      for (const agent of agents) {
        for (const fqn of agent.dependencyRefs.skills) referencedSkillFqns.add(fqn);
        for (const fqn of agent.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
      }
      for (const skill of skills) {
        for (const fqn of skill.dependencyRefs.skills) referencedSkillFqns.add(fqn);
        for (const fqn of skill.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
      }
      const skillByFqn = new Map<string, SkillEntity>(
        skills.map((skill) => [skill.fqn, skill] as const),
      );
      const mcpByFqn = new Map<string, (typeof mcps)[number]>(
        mcps.map((mcp) => [mcp.fqn, mcp] as const),
      );
      const skillCache = new Map<string, ComputedStatus>();
      const inFlight = new Set<string>();
      const computeSkillStatus = (skillEntity: SkillEntity): ComputedStatus => {
        const cached = skillCache.get(skillEntity.fqn);
        if (cached !== undefined) return cached;
        if (inFlight.has(skillEntity.fqn)) return { status: "ready" as const };
        inFlight.add(skillEntity.fqn);
        const reason: BlockedReason = {};
        if (!skillEntity.prereqsAck && (skillEntity.prereqs ?? "").trim().length > 0) {
          reason.needsPrereqsAck = true;
        }
        if (!referencedSkillFqns.has(skillEntity.fqn)) reason.orphaned = true;
        const missing: MissingDep[] = [];
        const blockedDeps: BlockedDep[] = [];
        for (const fqn of skillEntity.dependencyRefs.skills) {
          const child = skillByFqn.get(fqn);
          if (child === undefined) {
            missing.push({ kind: "skill", name: fqn });
            continue;
          }
          const childStatus = computeSkillStatus(child);
          if (childStatus.status === "blocked") blockedDeps.push({ kind: "skill", fqn: child.fqn });
        }
        for (const fqn of skillEntity.dependencyRefs.mcps) {
          const child = mcpByFqn.get(fqn);
          if (child === undefined) missing.push({ kind: "mcp", name: fqn });
        }
        if (missing.length > 0) reason.missingDeps = missing;
        if (blockedDeps.length > 0) reason.blockedDeps = blockedDeps;
        const result: ComputedStatus =
          Object.keys(reason).length === 0
            ? { status: "ready" as const }
            : { status: "blocked" as const, reason };
        inFlight.delete(skillEntity.fqn);
        skillCache.set(skillEntity.fqn, result);
        return result;
      };
      const computeAgentStatus = (agentEntity: AgentEntity): ComputedStatus => {
        const reason: BlockedReason = {};
        if (!agentEntity.prereqsAck && (agentEntity.prereqs ?? "").trim().length > 0) {
          reason.needsPrereqsAck = true;
        }
        if (agentEntity.disabledByUser) reason.disabledByUser = true;
        const missing: MissingDep[] = [];
        const blockedDeps: BlockedDep[] = [];
        for (const fqn of agentEntity.dependencyRefs.skills) {
          const child = skillByFqn.get(fqn);
          if (child === undefined) {
            missing.push({ kind: "skill", name: fqn });
            continue;
          }
          const childStatus = computeSkillStatus(child);
          if (childStatus.status === "blocked") blockedDeps.push({ kind: "skill", fqn: child.fqn });
        }
        for (const fqn of agentEntity.dependencyRefs.mcps) {
          const child = mcpByFqn.get(fqn);
          if (child === undefined) missing.push({ kind: "mcp", name: fqn });
        }
        if (missing.length > 0) reason.missingDeps = missing;
        if (blockedDeps.length > 0) reason.blockedDeps = blockedDeps;
        if (Object.keys(reason).length === 0) return { status: "ready" as const };
        return { status: "blocked" as const, reason };
      };
      const agentEntities = agents;
      return agentEntities.map((agentEntity) => {
        const dependencies =
          agentEntity.dependencyRefs.skills.length > 0 ||
          agentEntity.dependencyRefs.mcps.length > 0 ||
          agentEntity.dependencyRefs.agents.length > 0
            ? {
                ...(agentEntity.dependencyRefs.skills.length > 0
                  ? { skills: agentEntity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(agentEntity.dependencyRefs.mcps.length > 0
                  ? { mcps: agentEntity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
                ...(agentEntity.dependencyRefs.agents.length > 0
                  ? { agents: agentEntity.dependencyRefs.agents.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;
        const agent = {
          fqn: agentEntity.fqn,
          origin: agentEntity.origin,
          description: agentEntity.description,
          version: agentEntity.version,
          ...(agentEntity.prereqs !== undefined ? { prereqs: agentEntity.prereqs } : {}),
          prereqsAck: agentEntity.prereqsAck,
          disabledByUser: agentEntity.disabledByUser,
          installedAt: agentEntity.installedAt,
          updatedAt: agentEntity.updatedAt,
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
        const coordEligible = (agent.dependencies?.agents?.length ?? 0) > 0;
        const computed = computeAgentStatus(agentEntity);
        if (computed.status === "ready") return { agent, status: "ready" as const, coordEligible };
        const out = {
          agent,
          status: "blocked" as const,
          coordEligible,
          ...(computed.reason !== undefined ? { blockedReason: computed.reason } : {}),
        };
        return computed.reason?.missingDeps !== undefined
          ? { ...out, missingDeps: computed.reason.missingDeps }
          : out;
      });
    });
  }
}
