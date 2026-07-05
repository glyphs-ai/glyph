/**
 * Use case: apply a reconciliation plan. Install and sync share one apply
 * path — re-install every `toInstall` node via the per-kind install verbs,
 * poisoning dependents of any failure. On a root identity change, delete
 * the existing fqn first, then run the same install pass and surface the
 * plan's flagged orphans (empty for a
 * fresh install). Always succeeds — per-node failures live in the summary;
 * a failed identity-change delete is surfaced as a failed entry for the old fqn.
 *
 * Consumes `ResolvePlanResponse` (the resolve-plan use-case's output)
 * verbatim as its Request `plan`.
 */

import { okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { AgentRepository } from "../../domain/agent-repository.js";
import { McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { McpRepository } from "../../domain/mcp-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { InstallAgentError, InstallAgentUseCase } from "../agent/install-agent.js";
import type { InstallMcpError, InstallMcpUseCase } from "../mcp/install-mcp.js";
import type { InstallSkillError, InstallSkillUseCase } from "../skill/install-skill.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { ConflictSchema } from "./dependency-graph.js";
import {
  type PlanNode,
  type ResolvePlanResponse,
  ResolvePlanResponseSchema,
} from "./resolve-plan.js";

export const ApplyPlanRequestSchema = z.object({ plan: ResolvePlanResponseSchema });
export type ApplyPlanRequest = z.infer<typeof ApplyPlanRequestSchema>;

const InstalledSchema = z.object({
  kind: z.enum(["skill", "agent", "mcp"]),
  fqn: z.string(),
  prereqs: z.string().optional(),
  prereqsAck: z.boolean().optional(),
});
const SkippedSchema = z.object({
  kind: z.enum(["skill", "agent", "mcp"]),
  fqn: z.string(),
  reason: z.enum(["already-installed", "up-to-date", "dep-failed"]),
});
const FailedSchema = z.object({
  kind: z.enum(["skill", "agent", "mcp"]),
  fqn: z.string(),
  error: z.object({ name: z.string(), message: z.string() }),
});
const OrphanSchema = z.object({
  kind: z.enum(["skill", "mcp"]),
  fqn: z.string(),
  origin: z.string(),
});

export const ApplyPlanResponseSchema = z.object({
  installed: z.array(InstalledSchema),
  skipped: z.array(SkippedSchema),
  failed: z.array(FailedSchema),
  conflicts: z.array(ConflictSchema),
  orphansFlagged: z.array(OrphanSchema),
});
export type ApplyPlanResponse = z.infer<typeof ApplyPlanResponseSchema>;
export type CatalogApplyResult = ApplyPlanResponse;

export type ApplyPlanError = never;

export interface ApplyPlanDeps {
  readonly installSkill: InstallSkillUseCase;
  readonly installAgent: InstallAgentUseCase;
  readonly installMcp: InstallMcpUseCase;
  readonly repos: {
    skill: SkillRepository;
    agent: AgentRepository;
    mcp: McpRepository;
  };
}

type InstalledEntry = ApplyPlanResponse["installed"][number];
type InstallError = InstallSkillError | InstallAgentError | InstallMcpError;

export class ApplyPlanUseCase
  implements UseCase<ApplyPlanRequest, ApplyPlanResponse, ApplyPlanError>
{
  constructor(private readonly deps: ApplyPlanDeps) {}

  execute(request: ApplyPlanRequest): UseCaseResult<ApplyPlanResponse, ApplyPlanError> {
    return ResultAsync.fromSafePromise(this.run(request.plan));
  }

  /** Remove the pre-change fqn row for a root identity change (no-op if the old fqn is unparseable). */
  private removeOldIdentity(ic: NonNullable<ResolvePlanResponse["identityChange"]>) {
    if (ic.kind === "skill") {
      const fqn = SkillFqnSchema.safeParse(ic.oldFqn);
      return fqn.success ? this.deps.repos.skill.delete(fqn.data) : okAsync(undefined);
    }
    if (ic.kind === "agent") {
      const fqn = AgentFqnSchema.safeParse(ic.oldFqn);
      return fqn.success ? this.deps.repos.agent.delete(fqn.data) : okAsync(undefined);
    }
    const fqn = McpFqnSchema.safeParse(ic.oldFqn);
    return fqn.success ? this.deps.repos.mcp.delete(fqn.data) : okAsync(undefined);
  }

  private async run(plan: ResolvePlanResponse): Promise<ApplyPlanResponse> {
    const failed: ApplyPlanResponse["failed"] = [];

    // Root identity change: remove the old fqn before reinstalling under the new
    // one. A delete fault is surfaced as a failed entry for the old identity so
    // the caller learns the stale row may linger.
    const ic = plan.identityChange;
    if (ic) {
      const removed = await this.removeOldIdentity(ic);
      if (removed.isErr()) {
        failed.push({
          kind: ic.kind,
          fqn: ic.oldFqn,
          error: {
            name: removed.error.type,
            message: `could not remove prior identity "${ic.oldFqn}" before reinstall`,
          },
        });
      }
    }

    const installed: InstalledEntry[] = [];
    const skipped: ApplyPlanResponse["skipped"] = plan.alreadyInstalled.map((node) => ({
      kind: node.kind,
      fqn: node.fqn,
      reason: node.disposition === "up-to-date" ? "up-to-date" : "already-installed",
    }));
    const poisoned = new Set<string>();
    const originToFqn = new Map<string, string>();
    for (const node of [...plan.toInstall, ...plan.alreadyInstalled])
      originToFqn.set(node.origin, node.fqn);

    for (const node of plan.toInstall) {
      const failedDep = node.deps.find((origin) => poisoned.has(origin));
      if (failedDep !== undefined) {
        skipped.push({ kind: node.kind, fqn: node.fqn, reason: "dep-failed" });
        poisoned.add(node.origin);
        continue;
      }
      const outcome = await this.installNode(node, originToFqn);
      if ("error" in outcome) {
        failed.push({ kind: node.kind, fqn: node.fqn, error: outcome.error });
        poisoned.add(node.origin);
      } else {
        installed.push(outcome.installed);
      }
    }

    return { installed, skipped, failed, conflicts: plan.conflicts, orphansFlagged: plan.orphans };
  }

  private async installNode(
    node: PlanNode,
    originToFqn: ReadonlyMap<string, string>,
  ): Promise<{ installed: InstalledEntry } | { error: { name: string; message: string } }> {
    if (node.kind === "skill") {
      const result = await this.deps.installSkill.execute({
        origin: node.origin,
        dependencyRefs: {
          skills: node.dependencyRefs.skills.map((origin) => originToFqn.get(origin) ?? origin),
          mcps: node.dependencyRefs.mcps.map((origin) => originToFqn.get(origin) ?? origin),
        },
      });
      return result.match(
        (value) => ({
          installed: {
            kind: node.kind,
            fqn: value.id,
            ...(value.prereqs !== undefined ? { prereqs: value.prereqs } : {}),
            prereqsAck: value.prereqsAck,
          },
        }),
        (error) => ({ error: serializeInstallError(node.kind, error) }),
      );
    }
    if (node.kind === "agent") {
      const result = await this.deps.installAgent.execute({
        origin: node.origin,
        dependencyRefs: {
          skills: node.dependencyRefs.skills.map((origin) => originToFqn.get(origin) ?? origin),
          mcps: node.dependencyRefs.mcps.map((origin) => originToFqn.get(origin) ?? origin),
          agents: node.dependencyRefs.agents.map((origin) => originToFqn.get(origin) ?? origin),
        },
      });
      return result.match(
        (value) => ({
          installed: {
            kind: node.kind,
            fqn: value.id,
            ...(value.prereqs !== undefined ? { prereqs: value.prereqs } : {}),
            prereqsAck: value.prereqsAck,
          },
        }),
        (error) => ({ error: serializeInstallError(node.kind, error) }),
      );
    }
    const result = await this.deps.installMcp.execute({ origin: node.origin });
    return result.match(
      (value) => ({ installed: { kind: node.kind, fqn: value.id } }),
      (error) => ({ error: serializeInstallError(node.kind, error) }),
    );
  }
}

function serializeInstallError(
  kind: "skill" | "agent" | "mcp",
  error: InstallError,
): { name: string; message: string } {
  switch (error.type) {
    case "SkillOriginConflict":
      return {
        name: "SkillOriginConflictError",
        message: `skill ${error.fqn} is already installed from ${error.existingOrigin}`,
      };
    case "AgentOriginConflict":
      return {
        name: "AgentOriginConflictError",
        message: `agent ${error.fqn} is already installed from ${error.existingOrigin}`,
      };
    case "McpOriginConflict":
      return {
        name: "McpOriginConflictError",
        message: `mcp ${error.fqn} is already installed from ${error.existingOrigin}`,
      };
    case "OriginInvalid":
      return { name: "OriginParseError", message: error.reason };
    case "SourceUnavailable":
      return {
        name: "FetchError",
        message: error.cause instanceof Error ? error.cause.message : String(error.cause),
      };
    case "ManifestInvalid":
      return { name: manifestErrorName(kind), message: error.reason };
    case "DatabaseUnavailable":
      return {
        name: "DatabaseUnavailable",
        message: error.cause instanceof Error ? error.cause.message : String(error.cause),
      };
  }
}

function manifestErrorName(kind: "skill" | "agent" | "mcp"): string {
  if (kind === "skill") return "SkillFrontmatterError";
  if (kind === "agent") return "AgentFrontmatterError";
  return "McpInvalidJsonError";
}
