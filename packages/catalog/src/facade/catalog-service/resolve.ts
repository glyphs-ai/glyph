import { AgentNotFoundError } from "../../agent/errors.js";
import { safeNormalize } from "../../fetcher/index.js";
import { McpNotFoundError } from "../../mcp/errors.js";
import { SkillNotFoundError } from "../../skill/errors.js";
import type { CatalogPlan, CatalogPlanNode } from "../plan-types.js";
import {
  buildLocalClosure,
  buildUpstreamClosure,
  diffClosures,
  type PipelineServices,
} from "../resolve-pipeline.js";
import type { CatalogServiceCtx } from "./types.js";

export async function resolveSkill(ctx: CatalogServiceCtx, origin: string): Promise<CatalogPlan> {
  return runResolvePipeline(ctx, { kind: "skill", origin }, false);
}

export async function resolveAgentFromOrigin(
  ctx: CatalogServiceCtx,
  origin: string,
): Promise<CatalogPlan> {
  return runResolvePipeline(ctx, { kind: "agent", origin }, false);
}

export async function resolveMcp(ctx: CatalogServiceCtx, origin: string): Promise<CatalogPlan> {
  return runResolvePipeline(ctx, { kind: "mcp", origin }, false);
}

export async function resolveSyncSkill(ctx: CatalogServiceCtx, fqn: string): Promise<CatalogPlan> {
  const local = await ctx.rt.skill.get(fqn);
  if (local === null) throw new SkillNotFoundError(fqn);
  return runResolvePipeline(ctx, { kind: "skill", origin: local.origin }, true);
}

export async function resolveSyncAgent(ctx: CatalogServiceCtx, fqn: string): Promise<CatalogPlan> {
  const local = await ctx.rt.agent.get(fqn);
  if (local === null) throw new AgentNotFoundError(fqn);
  return runResolvePipeline(ctx, { kind: "agent", origin: local.origin }, true);
}

export async function resolveSyncMcp(ctx: CatalogServiceCtx, name: string): Promise<CatalogPlan> {
  const local = await ctx.rt.mcp.get(name);
  if (local === null) throw new McpNotFoundError(name);
  return runResolvePipeline(ctx, { kind: "mcp", origin: local.origin }, true);
}

async function runResolvePipeline(
  ctx: CatalogServiceCtx,
  root: { kind: "skill" | "agent" | "mcp"; origin: string },
  isSync: boolean,
): Promise<CatalogPlan> {
  const canonRoot = { ...root, origin: safeNormalize(root.origin) };
  const services: PipelineServices = {
    skill: ctx.rt.skill,
    agent: ctx.rt.agent,
    mcp: ctx.rt.mcp,
    resolveMcpAdapter: ctx.rt.resolveMcpAdapter,
  };
  const upstream = await buildUpstreamClosure(canonRoot, services, {
    mode: isSync ? "sync" : "install",
  });
  const local = await buildLocalClosure([canonRoot.origin], services);
  const globalReverseDepIndex = isSync
    ? await computeReverseDepIndex(ctx, canonRoot.origin)
    : undefined;
  const diff = diffClosures(upstream.closure, local, {
    rootOrigin: canonRoot.origin,
    rootKind: canonRoot.kind,
    isSync,
    ...(globalReverseDepIndex !== undefined ? { globalReverseDepIndex } : {}),
  });
  const noFetchNeeded =
    diff.toInstall.length === 0 &&
    upstream.conflicts.length === 0 &&
    diff.identityChange === undefined;
  const upToDate = isSync && noFetchNeeded && diff.orphans.length === 0;
  return {
    toInstall: diff.toInstall as CatalogPlanNode[],
    alreadyInstalled: diff.alreadyInstalled as CatalogPlanNode[],
    conflicts: upstream.conflicts,
    rootOrigin: canonRoot.origin,
    isSync,
    ...(diff.identityChange !== undefined ? { identityChange: diff.identityChange } : {}),
    orphans: diff.orphans,
    upToDate,
  };
}

async function computeReverseDepIndex(
  ctx: CatalogServiceCtx,
  rootOrigin: string,
): Promise<Set<string>> {
  const [skills, agents, mcps] = await Promise.all([
    ctx.rt.skill.list(),
    ctx.rt.agent.list(),
    ctx.rt.mcp.list(),
  ]);
  const skillOriginByFqn = new Map(skills.map((s) => [s.fqn, s.origin] as const));
  const mcpOriginByFqn = new Map(mcps.map((m) => [m.fqn, m.origin] as const));
  const referenced = new Set<string>();
  for (const a of agents) {
    if (a.origin === rootOrigin) continue;
    for (const d of a.dependencies.skills) {
      const o = skillOriginByFqn.get(d.fqn);
      if (o !== undefined) referenced.add(o);
    }
    for (const d of a.dependencies.mcps) {
      const o = mcpOriginByFqn.get(d.fqn);
      if (o !== undefined) referenced.add(o);
    }
  }
  for (const s of skills) {
    if (s.origin === rootOrigin) continue;
    for (const d of s.dependencies.skills) {
      const o = skillOriginByFqn.get(d.fqn);
      if (o !== undefined) referenced.add(o);
    }
    for (const d of s.dependencies.mcps) {
      const o = mcpOriginByFqn.get(d.fqn);
      if (o !== undefined) referenced.add(o);
    }
  }
  return referenced;
}
