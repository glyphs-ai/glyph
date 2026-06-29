import { err, ok } from "neverthrow";
import { z } from "zod";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import type { SkillEntity } from "../../domain/skill-entity.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const DependencyRefSchema = z.object({ fqn: z.string() });

const SkillDependenciesSchema = z
  .object({
    skills: z.array(DependencyRefSchema).optional(),
    mcps: z.array(DependencyRefSchema).optional(),
  })
  .optional();

const SkillSchema = z.object({
  fqn: z.string(),
  origin: z.string(),
  description: z.string(),
  version: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean(),
  orphaned: z.boolean(),
  installedAt: z.string(),
  updatedAt: z.string(),
  dependencies: SkillDependenciesSchema,
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
export const ListSkillEntriesRequestSchema = z.object({});
export type ListSkillEntriesRequest = z.infer<typeof ListSkillEntriesRequestSchema>;
const ListSkillEntrySchema = z.object({
  skill: SkillSchema,
  status: z.enum(["ready", "blocked"]),
  blockedReason: BlockedReasonSchema.optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
});
export const ListSkillEntriesResponseSchema = z.array(ListSkillEntrySchema);
export type ListSkillEntriesResponse = z.infer<typeof ListSkillEntriesResponseSchema>;
export type ListSkillEntriesError = DatabaseUnavailable;
export interface ListSkillEntriesDeps {
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
  readonly mcpRepo: McpRepository;
}

export class ListSkillEntriesUseCase
  implements UseCase<ListSkillEntriesRequest, ListSkillEntriesResponse, ListSkillEntriesError>
{
  constructor(private readonly deps: ListSkillEntriesDeps) {}

  async execute(
    _request: ListSkillEntriesRequest,
  ): UseCaseResult<ListSkillEntriesResponse, ListSkillEntriesError> {
    const skills = await this.deps.skillRepo.list();
    if (skills.isErr()) return err(skills.error);
    const agents = await this.deps.agentRepo.list();
    if (agents.isErr()) return err(agents.error);
    const mcps = await this.deps.mcpRepo.list();
    if (mcps.isErr()) return err(mcps.error);
    const referencedSkillFqns = new Set<string>();
    const referencedMcpFqns = new Set<string>();
    for (const agent of agents.value) {
      for (const fqn of agent.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      for (const fqn of agent.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    for (const skill of skills.value) {
      for (const fqn of skill.dependencyRefs.skills) referencedSkillFqns.add(fqn);
      for (const fqn of skill.dependencyRefs.mcps) referencedMcpFqns.add(fqn);
    }
    const skillByFqn = new Map<string, SkillEntity>(
      skills.value.map((skill) => [skill.fqn, skill] as const),
    );
    const mcpByFqn = new Map<string, (typeof mcps.value)[number]>(
      mcps.value.map((mcp) => [mcp.fqn, mcp] as const),
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
    const skillEntities = skills.value;
    return ok(
      skillEntities.map((skillEntity) => {
        const dependencies =
          skillEntity.dependencyRefs.skills.length > 0 || skillEntity.dependencyRefs.mcps.length > 0
            ? {
                ...(skillEntity.dependencyRefs.skills.length > 0
                  ? { skills: skillEntity.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                  : {}),
                ...(skillEntity.dependencyRefs.mcps.length > 0
                  ? { mcps: skillEntity.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                  : {}),
              }
            : undefined;
        const skill = {
          fqn: skillEntity.fqn,
          origin: skillEntity.origin,
          description: skillEntity.description,
          version: skillEntity.version,
          ...(skillEntity.prereqs !== undefined ? { prereqs: skillEntity.prereqs } : {}),
          prereqsAck: skillEntity.prereqsAck,
          orphaned: !referencedSkillFqns.has(skillEntity.fqn),
          installedAt: skillEntity.installedAt,
          updatedAt: skillEntity.updatedAt,
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
        const computed = computeSkillStatus(skillEntity);
        if (computed.status === "ready") return { skill, status: "ready" as const };
        const out = {
          skill,
          status: "blocked" as const,
          ...(computed.reason !== undefined ? { blockedReason: computed.reason } : {}),
        };
        return computed.reason?.missingDeps !== undefined
          ? { ...out, missingDeps: computed.reason.missingDeps }
          : out;
      }),
    );
  }
}
