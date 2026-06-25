import type { AgentEntity } from "../../agent/agent-entity.js";
import { safeNormalize } from "../../fetcher/index.js";
import type { McpEntity } from "../../mcp/mcp-entity.js";
import type { SkillEntity } from "../../skill/skill-entity.js";
import type {
  CatalogInstalledEntry,
  CatalogInstallFailure,
  CatalogInstallResult,
  CatalogInstallSkip,
  CatalogPlan,
  CatalogPlanNode,
  CatalogSyncResult,
} from "../plan-types.js";
import type { CatalogServiceCtx } from "./types.js";

export async function install(
  ctx: CatalogServiceCtx,
  plan: CatalogPlan,
): Promise<CatalogInstallResult> {
  const installed: CatalogInstalledEntry[] = [];
  const failed: CatalogInstallFailure[] = [];
  const skipped: CatalogInstallSkip[] = plan.alreadyInstalled.map((n) => ({
    kind: n.kind,
    fqn: n.node.fqn,
    reason: (n.disposition === "up-to-date" ? "up-to-date" : "already-installed") as
      | "already-installed"
      | "up-to-date",
  }));

  const poisoned = new Set<string>();
  const depsByOrigin = new Map<string, string[]>();
  for (const planNode of plan.toInstall) {
    depsByOrigin.set(planNode.node.origin, planRefs(planNode).map(safeNormalize));
  }

  for (const planNode of plan.toInstall) {
    const fqn = planNode.node.fqn;
    const origin = planNode.node.origin;
    const failedDep = (depsByOrigin.get(origin) ?? []).find((dep) => poisoned.has(dep));
    if (failedDep !== undefined) {
      skipped.push({ kind: planNode.kind, fqn, reason: "dep-failed" });
      poisoned.add(origin);
      continue;
    }
    try {
      const persisted = await installNode(ctx, planNode);
      installed.push(toInstalledEntry(planNode.kind, fqn, persisted));
    } catch (err) {
      failed.push({ kind: planNode.kind, fqn, error: serializeInstallError(err) });
      poisoned.add(origin);
    }
  }

  return { installed, skipped, failed, conflicts: plan.conflicts };
}

export async function applySync(
  ctx: CatalogServiceCtx,
  plan: CatalogPlan,
): Promise<CatalogSyncResult> {
  if (plan.identityChange !== undefined) {
    const ic = plan.identityChange;
    if (ic.kind === "skill") await ctx.rt.skill.delete(ic.oldFqn);
    else if (ic.kind === "agent") await ctx.rt.agent.delete(ic.oldFqn);
    else await ctx.rt.mcp.delete(ic.oldFqn);
  }
  const result = await install(ctx, plan);
  return { ...result, orphansFlagged: plan.orphans };
}

async function installNode(
  ctx: CatalogServiceCtx,
  planNode: CatalogPlanNode,
): Promise<SkillEntity | AgentEntity | McpEntity> {
  if (planNode.kind === "skill") return ctx.rt.skill.install(planNode.node);
  if (planNode.kind === "agent") return ctx.rt.agent.install(planNode.node);
  return ctx.rt.mcp.install(planNode.node.fqn, planNode.node.origin, planNode.node.content);
}

function planRefs(planNode: CatalogPlanNode): string[] {
  if (planNode.kind === "mcp") return [];
  if (planNode.kind === "agent") {
    return [
      ...planNode.node.depsRefs.skills,
      ...planNode.node.depsRefs.mcps,
      ...planNode.node.depsRefs.agents,
    ];
  }
  return [...planNode.node.depsRefs.skills, ...planNode.node.depsRefs.mcps];
}

function toInstalledEntry(
  kind: "mcp" | "skill" | "agent",
  fqn: string,
  entity: SkillEntity | AgentEntity | McpEntity,
): CatalogInstalledEntry {
  if (kind === "mcp") return { kind, fqn };
  const e = entity as SkillEntity | AgentEntity;
  const prereqs = e.prereqs;
  const out: CatalogInstalledEntry = { kind, fqn, prereqsAck: e.prereqsAck };
  if (prereqs !== undefined && prereqs.trim().length > 0) return { ...out, prereqs };
  return out;
}

function serializeInstallError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  if (typeof err === "string") return { name: "Error", message: err };
  return { name: "Error", message: String(err) };
}
