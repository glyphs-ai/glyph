import { safeNormalize } from "../../fetcher/origin.js";
import {
  agentEntityToResolvedNode,
  mcpEntityToResolvedNode,
  skillEntityToResolvedNode,
} from "./_helpers.js";
import type { Closure, ClosureNode, PipelineServices } from "./types.js";

/**
 * Walk the locally-installed graph, transitively closing
 * over the deps that ARE installed. Origins that are seeded but
 * not installed locally simply don't appear in the result map
 * (no conflict generated — the local closure is a snapshot of
 * what's on disk).
 *
 * `seedOrigins` is the entry-point set; the walk transitively
 * follows `dependencies.{skills,mcps}` from each seed. For sync,
 * pass just the root origin; for install, pass the upstream
 * closure's origins (so we know which slots are already filled).
 *
 * No cycle detection here: install/sync rejects cycles upstream,
 * so the local catalog is acyclic by construction. Visited-set
 * dedupe guards against accidental loops if a bypass path
 * (direct repo write) ever produced one.
 */
export async function buildLocalClosure(
  seedOrigins: Iterable<string>,
  services: PipelineServices,
): Promise<Closure> {
  const closure = new Map<string, ClosureNode>();
  const visited = new Set<string>();
  const [skills, agents, mcps] = await Promise.all([
    services.skill.list(),
    services.agent.list(),
    services.mcp.list(),
  ]);
  const skillByOrigin = new Map(skills.map((s) => [s.origin, s] as const));
  const agentByOrigin = new Map(agents.map((a) => [a.origin, a] as const));
  const mcpByOrigin = new Map(mcps.map((m) => [m.origin, m] as const));
  const skillOriginByFqn = new Map(skills.map((s) => [s.fqn, s.origin] as const));
  const mcpOriginByFqn = new Map(mcps.map((m) => [m.fqn, m.origin] as const));
  const agentOriginByFqn = new Map(agents.map((a) => [a.fqn, a.origin] as const));

  async function visit(rawOrigin: string): Promise<void> {
    const origin = safeNormalize(rawOrigin);
    if (visited.has(origin)) return;
    visited.add(origin);

    const skill = skillByOrigin.get(origin);
    if (skill !== undefined) {
      const anchorContent = await services.skill.getAnchor(skill.fqn).catch(() => "");
      closure.set(origin, {
        kind: "skill",
        source: "local",
        node: skillEntityToResolvedNode(skill, anchorContent, skillOriginByFqn, mcpOriginByFqn),
      });
      for (const d of skill.dependencies.mcps) {
        const o = mcpOriginByFqn.get(d.fqn);
        if (o !== undefined) await visit(o);
      }
      for (const d of skill.dependencies.skills) {
        const o = skillOriginByFqn.get(d.fqn);
        if (o !== undefined) await visit(o);
      }
      return;
    }
    const agent = agentByOrigin.get(origin);
    if (agent !== undefined) {
      const anchorContent = await services.agent.getAnchor(agent.fqn).catch(() => "");
      closure.set(origin, {
        kind: "agent",
        source: "local",
        node: agentEntityToResolvedNode(
          agent,
          anchorContent,
          skillOriginByFqn,
          mcpOriginByFqn,
          agentOriginByFqn,
        ),
      });
      for (const d of agent.dependencies.mcps) {
        const o = mcpOriginByFqn.get(d.fqn);
        if (o !== undefined) await visit(o);
      }
      for (const d of agent.dependencies.skills) {
        const o = skillOriginByFqn.get(d.fqn);
        if (o !== undefined) await visit(o);
      }
      for (const d of agent.dependencies.agents) {
        const o = agentOriginByFqn.get(d.fqn);
        if (o !== undefined) await visit(o);
      }
      return;
    }
    const mcp = mcpByOrigin.get(origin);
    if (mcp !== undefined) {
      closure.set(origin, { kind: "mcp", source: "local", node: mcpEntityToResolvedNode(mcp) });
    }
  }

  for (const origin of seedOrigins) await visit(origin);
  return closure;
}
