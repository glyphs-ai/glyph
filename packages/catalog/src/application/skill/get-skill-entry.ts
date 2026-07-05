import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectInstalledMcpFqns } from "../mcp/mcp-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import {
  collectReferencedSkillFqns,
  type SkillView,
  selectAllSkills,
  selectSkillByFqn,
} from "./skill-reads.js";

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
export const GetSkillEntryRequestSchema = z.object({ id: SkillFqnSchema });
export type GetSkillEntryRequest = z.infer<typeof GetSkillEntryRequestSchema>;
const GetSkillEntrySchema = z.object({
  skill: SkillSchema,
  status: z.enum(["ready", "blocked"]),
  blockedReason: BlockedReasonSchema.optional(),
  missingDeps: z.array(MissingDepSchema).optional(),
});
export const GetSkillEntryResponseSchema = GetSkillEntrySchema.nullable();
export type GetSkillEntryResponse = z.infer<typeof GetSkillEntryResponseSchema>;
export type GetSkillEntryError = DatabaseUnavailable;
export interface GetSkillEntryDeps {
  readonly queries: CatalogQueries;
}

export class GetSkillEntryUseCase
  implements UseCase<GetSkillEntryRequest, GetSkillEntryResponse, GetSkillEntryError>
{
  constructor(private readonly deps: GetSkillEntryDeps) {}

  execute(request: GetSkillEntryRequest): UseCaseResult<GetSkillEntryResponse, GetSkillEntryError> {
    const { id } = request;
    return this.deps.queries.query((db): GetSkillEntryResponse => {
      const target = selectSkillByFqn(db, id);
      if (target === undefined) return null;

      const installed = selectAllSkills(db);
      const referencedSkillFqns = collectReferencedSkillFqns(db);
      const installedMcpFqns = selectInstalledMcpFqns(db);
      const skillByFqn = new Map<string, SkillView>(installed.map((s) => [s.fqn, s] as const));

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

      const dependencies =
        target.dependencyRefs.skills.length > 0 || target.dependencyRefs.mcps.length > 0
          ? {
              ...(target.dependencyRefs.skills.length > 0
                ? { skills: target.dependencyRefs.skills.map((fqn) => ({ fqn })) }
                : {}),
              ...(target.dependencyRefs.mcps.length > 0
                ? { mcps: target.dependencyRefs.mcps.map((fqn) => ({ fqn })) }
                : {}),
            }
          : undefined;
      const skill = {
        fqn: target.fqn,
        origin: target.origin,
        description: target.description,
        version: target.version,
        ...(target.prereqs !== undefined ? { prereqs: target.prereqs } : {}),
        prereqsAck: target.prereqsAck,
        orphaned: !referencedSkillFqns.has(target.fqn),
        installedAt: target.installedAt,
        updatedAt: target.updatedAt,
        ...(dependencies !== undefined ? { dependencies } : {}),
      };
      const computed = computeSkillStatus(target);
      if (computed.status === "ready") return { skill, status: "ready" as const };
      const out = {
        skill,
        status: "blocked" as const,
        ...(computed.reason !== undefined ? { blockedReason: computed.reason } : {}),
      };
      return computed.reason?.missingDeps !== undefined
        ? { ...out, missingDeps: computed.reason.missingDeps }
        : out;
    });
  }
}
