import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectInstalledMcpFqns } from "../mcp/mcp-reads.js";
import {
  collectReferencedSkillFqns,
  type SkillView,
  selectAllSkills,
} from "../skill/skill-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { type AgentView, selectAllAgents } from "./agent-reads.js";

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
  readonly queries: CatalogQueries;
}

export class ListAgentEntriesUseCase
  implements UseCase<ListAgentEntriesRequest, ListAgentEntriesResponse, ListAgentEntriesError>
{
  constructor(private readonly deps: ListAgentEntriesDeps) {}

  execute(
    _request: ListAgentEntriesRequest,
  ): UseCaseResult<ListAgentEntriesResponse, ListAgentEntriesError> {
    return this.deps.queries.query((db) => {
      const installed = selectAllAgents(db);
      const skills = selectAllSkills(db);
      const referencedSkillFqns = collectReferencedSkillFqns(db);
      const installedMcpFqns = selectInstalledMcpFqns(db);
      const skillByFqn = new Map<string, SkillView>(skills.map((s) => [s.fqn, s]));

      const skillCache = new Map<string, ComputedStatus>();
      const inFlight = new Set<string>();
      const computeSkillStatus = (skill: SkillView): ComputedStatus => {
        const cached = skillCache.get(skill.fqn);
        if (cached !== undefined) return cached;
        if (inFlight.has(skill.fqn)) return { status: "ready" as const };
        inFlight.add(skill.fqn);
        const reason: BlockedReason = {};
        if (!skill.prereqsAck && (skill.prereqs ?? "").trim().length > 0) {
          reason.needsPrereqsAck = true;
        }
        if (!referencedSkillFqns.has(skill.fqn)) reason.orphaned = true;
        const missing: MissingDep[] = [];
        const blockedDeps: BlockedDep[] = [];
        for (const fqn of skill.dependencyRefs.skills) {
          const child = skillByFqn.get(fqn);
          if (child === undefined) {
            missing.push({ kind: "skill", name: fqn });
            continue;
          }
          const childStatus = computeSkillStatus(child);
          if (childStatus.status === "blocked") blockedDeps.push({ kind: "skill", fqn: child.fqn });
        }
        for (const fqn of skill.dependencyRefs.mcps) {
          if (!installedMcpFqns.has(fqn)) missing.push({ kind: "mcp", name: fqn });
        }
        if (missing.length > 0) reason.missingDeps = missing;
        if (blockedDeps.length > 0) reason.blockedDeps = blockedDeps;
        const result: ComputedStatus =
          Object.keys(reason).length === 0
            ? { status: "ready" as const }
            : { status: "blocked" as const, reason };
        inFlight.delete(skill.fqn);
        skillCache.set(skill.fqn, result);
        return result;
      };
      const computeAgentStatus = (agent: AgentView): ComputedStatus => {
        const reason: BlockedReason = {};
        if (!agent.prereqsAck && (agent.prereqs ?? "").trim().length > 0) {
          reason.needsPrereqsAck = true;
        }
        if (agent.disabledByUser) reason.disabledByUser = true;
        const missing: MissingDep[] = [];
        const blockedDeps: BlockedDep[] = [];
        for (const fqn of agent.dependencyRefs.skills) {
          const child = skillByFqn.get(fqn);
          if (child === undefined) {
            missing.push({ kind: "skill", name: fqn });
            continue;
          }
          const childStatus = computeSkillStatus(child);
          if (childStatus.status === "blocked") blockedDeps.push({ kind: "skill", fqn: child.fqn });
        }
        for (const fqn of agent.dependencyRefs.mcps) {
          if (!installedMcpFqns.has(fqn)) missing.push({ kind: "mcp", name: fqn });
        }
        if (missing.length > 0) reason.missingDeps = missing;
        if (blockedDeps.length > 0) reason.blockedDeps = blockedDeps;
        if (Object.keys(reason).length === 0) return { status: "ready" as const };
        return { status: "blocked" as const, reason };
      };

      return installed.map((target) => {
        const dependencies =
          target.dependencyRefs.skills.length > 0 ||
          target.dependencyRefs.mcps.length > 0 ||
          target.dependencyRefs.agents.length > 0
            ? {
                ...(target.dependencyRefs.skills.length > 0
                  ? { skills: target.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(target.dependencyRefs.mcps.length > 0
                  ? { mcps: target.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
                ...(target.dependencyRefs.agents.length > 0
                  ? { agents: target.dependencyRefs.agents.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;
        const agent = {
          fqn: target.fqn,
          origin: target.origin,
          description: target.description,
          version: target.version,
          ...(target.prereqs !== undefined ? { prereqs: target.prereqs } : {}),
          prereqsAck: target.prereqsAck,
          disabledByUser: target.disabledByUser,
          installedAt: target.installedAt,
          updatedAt: target.updatedAt,
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
        const coordEligible = (agent.dependencies?.agents?.length ?? 0) > 0;
        const computed = computeAgentStatus(target);
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
