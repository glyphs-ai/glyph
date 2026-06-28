import { AgentNotFoundError } from "../../contract/agent.errors.js";
import type {
  Agent,
  AgentEntry,
  AgentResolveResult,
  Mcp,
  ResolvedMcp,
  ResolvedSkill,
  Skill,
  SkillEntry,
  SkillResolveResult,
} from "../../contract/catalog.types.js";
import { SkillNotFoundError } from "../../contract/skill.errors.js";
import type { AgentEntity } from "../../domain/agent.entity.js";
import type { McpEntity } from "../../domain/mcp.entity.js";
import * as McpFormat from "../../domain/mcp.format.js";
import type { SkillEntity } from "../../domain/skill.entity.js";
import {
  buildAgentEntry,
  buildSkillEntry,
  newCascadeContext,
  projectAgentPojo,
  projectMcpMetadata,
  projectSkillPojo,
} from "../catalog.projection.js";
import type { CatalogServiceCtx } from "./types.js";

export async function listSkillEntries(ctx: CatalogServiceCtx): Promise<SkillEntry[]> {
  const cascadeCtx = await loadCascadeContext(ctx);
  return [...cascadeCtx.skillByFqn.values()].map((s) => buildSkillEntry(s, cascadeCtx));
}

export async function listAgentEntries(ctx: CatalogServiceCtx): Promise<AgentEntry[]> {
  const [agents, cascadeCtx] = await Promise.all([ctx.rt.agent.list(), loadCascadeContext(ctx)]);
  return agents.map((a) => buildAgentEntry(a, cascadeCtx));
}

export async function listMcps(ctx: CatalogServiceCtx): Promise<Mcp[]> {
  const cascadeCtx = await loadCascadeContext(ctx);
  return [...cascadeCtx.mcpByFqn.values()].map((m) => projectMcpMetadata(m, cascadeCtx));
}

export async function listSkills(ctx: CatalogServiceCtx): Promise<Skill[]> {
  const cascadeCtx = await loadCascadeContext(ctx);
  return [...cascadeCtx.skillByFqn.values()].map((s) => projectSkillPojo(s, cascadeCtx));
}

export async function listAgents(ctx: CatalogServiceCtx): Promise<Agent[]> {
  const agents = await ctx.rt.agent.list();
  return agents.map((a) => projectAgentPojo(a));
}

export async function getSkillEntry(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<SkillEntry | null> {
  const s = await ctx.rt.skill.get(fqn);
  if (s === null) return null;
  const cascadeCtx = await loadCascadeContext(ctx);
  return buildSkillEntry(s, cascadeCtx);
}

export async function getAgentEntry(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<AgentEntry | null> {
  const a = await ctx.rt.agent.get(fqn);
  if (a === null) return null;
  const cascadeCtx = await loadCascadeContext(ctx);
  return buildAgentEntry(a, cascadeCtx);
}

export async function getSkillContent(ctx: CatalogServiceCtx, fqn: string): Promise<string> {
  const s = await ctx.rt.skill.get(fqn);
  if (s === null) throw new SkillNotFoundError(fqn);
  return ctx.rt.skill.getAnchor(fqn);
}

export async function getAgentContent(ctx: CatalogServiceCtx, fqn: string): Promise<string> {
  const a = await ctx.rt.agent.get(fqn);
  if (a === null) throw new AgentNotFoundError(fqn);
  return ctx.rt.agent.getAnchor(fqn);
}

export async function listAgentFiles(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<{ relPath: string; size: number }[]> {
  return ctx.rt.agentRepo.listFilePaths(fqn);
}

export async function listSkillFiles(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<{ relPath: string; size: number }[]> {
  return ctx.rt.skillRepo.listFilePaths(fqn);
}

export async function getAgentFile(
  ctx: CatalogServiceCtx,
  fqn: string,
  relPath: string,
): Promise<Buffer | null> {
  return ctx.rt.agentRepo.getFile(fqn, relPath);
}

export async function getSkillFile(
  ctx: CatalogServiceCtx,
  fqn: string,
  relPath: string,
): Promise<Buffer | null> {
  return ctx.rt.skillRepo.getFile(fqn, relPath);
}

export async function getMcpContent(ctx: CatalogServiceCtx, fqn: string): Promise<string> {
  return ctx.rt.mcp.getContent(fqn);
}

export async function getMcpRuntimeConfig(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<Record<string, unknown>> {
  const raw = await ctx.rt.mcp.getContent(fqn);
  return McpFormat.stripMeta(raw, `mcps:${fqn}`);
}

export async function getSkill(ctx: CatalogServiceCtx, fqn: string): Promise<Skill | null> {
  const s = await ctx.rt.skill.get(fqn);
  if (s === null) return null;
  const cascadeCtx = await loadCascadeContext(ctx);
  return projectSkillPojo(s, cascadeCtx);
}

export async function getAgent(ctx: CatalogServiceCtx, fqn: string): Promise<Agent | null> {
  const a = await ctx.rt.agent.get(fqn);
  if (a === null) return null;
  return projectAgentPojo(a);
}

export async function getMcp(ctx: CatalogServiceCtx, name: string): Promise<Mcp | null> {
  const m = await ctx.rt.mcp.get(name);
  if (m === null) return null;
  const cascadeCtx = await loadCascadeContext(ctx);
  return projectMcpMetadata(m, cascadeCtx);
}

export function listMcpEntities(ctx: CatalogServiceCtx): Promise<McpEntity[]> {
  return ctx.rt.mcp.list();
}

export function listSkillEntities(ctx: CatalogServiceCtx): Promise<SkillEntity[]> {
  return ctx.rt.skill.list();
}

export function listAgentEntities(ctx: CatalogServiceCtx): Promise<AgentEntity[]> {
  return ctx.rt.agent.list();
}

export async function* agentEntries(
  ctx: CatalogServiceCtx,
  fqn: string,
): AsyncIterable<{ relPath: string; content: Buffer }> {
  if (!(await ctx.rt.agent.has(fqn))) throw new AgentNotFoundError(fqn);
  for await (const f of ctx.rt.agent.streamFiles(fqn)) {
    yield { relPath: f.relPath, content: f.content };
  }
}

export async function* skillEntries(
  ctx: CatalogServiceCtx,
  fqn: string,
): AsyncIterable<{ relPath: string; content: Buffer }> {
  if (!(await ctx.rt.skill.has(fqn))) throw new SkillNotFoundError(fqn);
  for await (const f of ctx.rt.skill.streamFiles(fqn)) {
    yield { relPath: f.relPath, content: f.content };
  }
}

export async function resolveAgent(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<AgentResolveResult> {
  const [agents, skills, mcps] = await Promise.all([
    ctx.rt.agent.list(),
    ctx.rt.skill.list(),
    ctx.rt.mcp.list(),
  ]);
  const agent = agents.find((a) => a.fqn === fqn);
  if (agent === undefined) throw new AgentNotFoundError(fqn);
  const cascadeCtx = newCascadeContext(skills, agents, mcps);
  const visited = new Set<string>();
  const orderedSkills: SkillEntity[] = [];
  const mcpFqns = new Set<string>();
  const walk = (
    skillDeps: ReadonlyArray<{ readonly fqn: string }>,
    mcpDeps: ReadonlyArray<{ readonly fqn: string }>,
  ): void => {
    for (const d of mcpDeps) {
      const m = cascadeCtx.mcpByFqn.get(d.fqn);
      if (m !== undefined) mcpFqns.add(m.fqn);
    }
    for (const d of skillDeps) {
      if (visited.has(d.fqn)) continue;
      visited.add(d.fqn);
      const skill = cascadeCtx.skillByFqn.get(d.fqn);
      if (skill === undefined) continue;
      walk(skill.dependencies.skills, skill.dependencies.mcps);
      orderedSkills.push(skill);
    }
  };
  walk(agent.dependencies.skills, agent.dependencies.mcps);
  return {
    agent: projectAgentPojo(agent),
    skills: orderedSkills.map<ResolvedSkill>((s) => ({ skill: projectSkillPojo(s, cascadeCtx) })),
    mcps: [...mcpFqns].map<ResolvedMcp>((mcpFqn) => ({ fqn: mcpFqn })),
  };
}

export async function resolveSkillFromCatalog(
  ctx: CatalogServiceCtx,
  fqn: string,
): Promise<SkillResolveResult> {
  const [skills, agents, mcps] = await Promise.all([
    ctx.rt.skill.list(),
    ctx.rt.agent.list(),
    ctx.rt.mcp.list(),
  ]);
  const root = skills.find((s) => s.fqn === fqn);
  if (root === undefined) throw new SkillNotFoundError(fqn);
  const cascadeCtx = newCascadeContext(skills, agents, mcps);
  const visited = new Set<string>();
  const ordered: SkillEntity[] = [];
  const mcpFqns = new Set<string>();
  const walk = (skillFqn: string): void => {
    if (visited.has(skillFqn)) return;
    visited.add(skillFqn);
    const skill = cascadeCtx.skillByFqn.get(skillFqn);
    if (skill === undefined) return;
    for (const d of skill.dependencies.mcps) {
      const m = cascadeCtx.mcpByFqn.get(d.fqn);
      if (m !== undefined) mcpFqns.add(m.fqn);
    }
    for (const d of skill.dependencies.skills) walk(d.fqn);
    ordered.push(skill);
  };
  walk(root.fqn);
  return {
    skill: projectSkillPojo(root, cascadeCtx),
    skills: ordered.map<ResolvedSkill>((s) => ({ skill: projectSkillPojo(s, cascadeCtx) })),
    mcps: [...mcpFqns].map<ResolvedMcp>((mcpFqn) => ({ fqn: mcpFqn })),
  };
}

export async function findSkillDependents(
  ctx: CatalogServiceCtx,
  targetFqn: string,
): Promise<{ kind: "skill" | "agent"; name: string }[]> {
  const [agents, skills] = await Promise.all([
    ctx.rt.skillRepo.findDependentAgents(targetFqn),
    ctx.rt.skillRepo.findDependentSkills(targetFqn),
  ]);
  return [
    ...skills.map((name) => ({ kind: "skill" as const, name })),
    ...agents.map((name) => ({ kind: "agent" as const, name })),
  ];
}

export async function findMcpDependents(
  ctx: CatalogServiceCtx,
  targetFqn: string,
): Promise<{ kind: "skill" | "agent"; name: string }[]> {
  const [agents, skills] = await Promise.all([
    ctx.rt.mcpRepo.findDependentAgents(targetFqn),
    ctx.rt.mcpRepo.findDependentSkills(targetFqn),
  ]);
  return [
    ...skills.map((name) => ({ kind: "skill" as const, name })),
    ...agents.map((name) => ({ kind: "agent" as const, name })),
  ];
}

export async function findAgentDependents(
  ctx: CatalogServiceCtx,
  targetFqn: string,
): Promise<{ kind: "skill" | "agent"; name: string }[]> {
  const agents = await ctx.rt.agentRepo.findDependentAgents(targetFqn);
  return agents.map((name) => ({ kind: "agent" as const, name }));
}

export async function findDependents(
  ctx: CatalogServiceCtx,
  targetFqn: string,
): Promise<{ kind: "skill" | "agent"; name: string }[]> {
  const mcp = await ctx.rt.mcp.get(targetFqn);
  if (mcp !== null) return findMcpDependents(ctx, targetFqn);
  const skill = await ctx.rt.skill.get(targetFqn);
  if (skill !== null) return findSkillDependents(ctx, targetFqn);
  const agent = await ctx.rt.agent.get(targetFqn);
  if (agent !== null) return findAgentDependents(ctx, targetFqn);
  return [];
}

export async function acknowledgeSkillPrereqs(ctx: CatalogServiceCtx, fqn: string): Promise<Skill> {
  const updated = await ctx.rt.skill.acknowledgePrereqs(fqn);
  const cascadeCtx = await loadCascadeContext(ctx);
  return projectSkillPojo(updated, cascadeCtx);
}

export async function acknowledgeAgentPrereqs(ctx: CatalogServiceCtx, fqn: string): Promise<Agent> {
  const updated = await ctx.rt.agent.acknowledgePrereqs(fqn);
  return projectAgentPojo(updated);
}

export async function disableAgent(ctx: CatalogServiceCtx, fqn: string): Promise<Agent> {
  const updated = await ctx.rt.agent.disableByUser(fqn);
  return projectAgentPojo(updated);
}

export async function enableAgent(ctx: CatalogServiceCtx, fqn: string): Promise<Agent> {
  const updated = await ctx.rt.agent.enableByUser(fqn);
  return projectAgentPojo(updated);
}

export async function loadCascadeContext(ctx: CatalogServiceCtx) {
  const [skills, agents, mcps] = await Promise.all([
    ctx.rt.skill.list(),
    ctx.rt.agent.list(),
    ctx.rt.mcp.list(),
  ]);
  return newCascadeContext(skills, agents, mcps);
}
