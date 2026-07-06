import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectInstalledMcpFqns } from "../mcp/mcp-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedSkillFqns, type SkillView, selectAllSkills } from "./skill-reads.js";

const listSkillEntriesMissingDep = z.object({
  kind: z.enum(["skill", "mcp"]),
  name: z.string(),
});
type MissingDep = z.infer<typeof listSkillEntriesMissingDep>;

const listSkillEntriesBlockedDep = z.object({
  kind: z.enum(["skill", "mcp"]),
  fqn: z.string(),
});
type BlockedDep = z.infer<typeof listSkillEntriesBlockedDep>;

type BlockedReason = NonNullable<
  z.infer<typeof ListSkillEntriesResponseSchema>[number]["blockedReason"]
>;

interface ComputedStatus {
  readonly status: "ready" | "blocked";
  readonly reason?: BlockedReason;
}
export const ListSkillEntriesRequestSchema = z.object({});
export type ListSkillEntriesRequest = z.infer<typeof ListSkillEntriesRequestSchema>;
export const ListSkillEntriesResponseSchema = z.array(
  z.object({
    skill: z.object({
      fqn: z.string(),
      origin: z.string(),
      description: z.string(),
      version: z.string(),
      prereqs: z.string().optional(),
      prereqsAck: z.boolean(),
      orphaned: z.boolean(),
      installedAt: z.string(),
      updatedAt: z.string(),
      dependencies: z
        .object({
          skills: z.array(z.object({ fqn: z.string() })).optional(),
          mcps: z.array(z.object({ fqn: z.string() })).optional(),
        })
        .optional(),
    }),
    status: z.enum(["ready", "blocked"]),
    blockedReason: z
      .object({
        needsPrereqsAck: z.literal(true).optional(),
        disabledByUser: z.literal(true).optional(),
        orphaned: z.literal(true).optional(),
        missingDeps: z.array(listSkillEntriesMissingDep).optional(),
        blockedDeps: z.array(listSkillEntriesBlockedDep).optional(),
      })
      .optional(),
    missingDeps: z.array(listSkillEntriesMissingDep).optional(),
  }),
);
export type ListSkillEntriesResponse = z.infer<typeof ListSkillEntriesResponseSchema>;
export type ListSkillEntriesError = DatabaseUnavailable;
export interface ListSkillEntriesDeps {
  readonly queries: CatalogQueries;
}

export class ListSkillEntriesUseCase
  implements UseCase<ListSkillEntriesRequest, ListSkillEntriesResponse, ListSkillEntriesError>
{
  constructor(private readonly deps: ListSkillEntriesDeps) {}

  execute(
    _request: ListSkillEntriesRequest,
  ): UseCaseResult<ListSkillEntriesResponse, ListSkillEntriesError> {
    return this.deps.queries.query((db) => {
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

      return installed.map((target) => {
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
    });
  }
}
