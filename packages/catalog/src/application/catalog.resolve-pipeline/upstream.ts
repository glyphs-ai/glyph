import { CyclicDependencyError } from "../../domain/skill.errors.js";
import { safeNormalize } from "../../fetcher/origin.js";
import type { CatalogConflict } from "../catalog.plan-types.js";
import {
  agentEntityToResolvedNode,
  mcpEntityToResolvedNode,
  skillEntityToResolvedNode,
} from "./_helpers.js";
import type { Closure, ClosureNode, PipelineServices } from "./types.js";

export interface UpstreamClosureOpts {
  /**
   * "install" mode: when traversing a dep, if the dep is already
   * installed locally we record its local node and DO NOT fetch
   * upstream — install mode's per-shared-dep network round-trip
   * optimization.
   *
   * "sync" mode: always fetch upstream for every node in the
   * closure, even if locally installed. "sync" opts out of the
   * optimization so phase 3 can compare versions and detect dep
   * churn.
   */
  readonly mode: "install" | "sync";
}

export interface UpstreamClosureResult {
  readonly closure: Closure;
  readonly conflicts: readonly CatalogConflict[];
}

/**
 * Walk the upstream graph from the root, producing a
 * closure of every reachable node.
 *
 * Cycle detection uses standard DFS coloring (inStack = GRAY,
 * visited = BLACK). Back-edge → {@link CyclicDependencyError}.
 * Diamonds (same origin via two non-overlapping paths) dedupe
 * via the visited check.
 *
 * Conflicts (fetch-failed / parse-failed / origin-conflict) are
 * collected per-origin and returned alongside the closure rather
 * than thrown — the caller can present a partial plan with errors
 * inline rather than an all-or-nothing failure.
 */
export async function buildUpstreamClosure(
  root: { kind: "skill" | "agent" | "mcp"; origin: string },
  services: PipelineServices,
  opts: UpstreamClosureOpts,
): Promise<UpstreamClosureResult> {
  const closure = new Map<string, ClosureNode>();
  const conflicts: CatalogConflict[] = [];
  const inStack = new Set<string>();
  const visited = new Set<string>();

  let cachedMaps: {
    skillOriginByFqn: Map<string, string>;
    mcpOriginByFqn: Map<string, string>;
    agentOriginByFqn: Map<string, string>;
  } | null = null;
  async function getMaps(): Promise<{
    skillOriginByFqn: Map<string, string>;
    mcpOriginByFqn: Map<string, string>;
    agentOriginByFqn: Map<string, string>;
  }> {
    if (cachedMaps !== null) return cachedMaps;
    const [skills, mcps, agents] = await Promise.all([
      services.skill.list(),
      services.mcp.list(),
      services.agent.list(),
    ]);
    cachedMaps = {
      skillOriginByFqn: new Map(skills.map((s) => [s.fqn, s.origin] as const)),
      mcpOriginByFqn: new Map(mcps.map((m) => [m.fqn, m.origin] as const)),
      agentOriginByFqn: new Map(agents.map((a) => [a.fqn, a.origin] as const)),
    };
    return cachedMaps;
  }

  async function walkSkill(rawOrigin: string, isRoot: boolean): Promise<void> {
    const origin = safeNormalize(rawOrigin);
    if (inStack.has(origin)) {
      throw new CyclicDependencyError([...inStack, origin]);
    }
    if (visited.has(origin)) return;

    if (opts.mode === "install" && !isRoot) {
      const local = await services.skill.getByOrigin(origin);
      if (local !== null) {
        const maps = await getMaps();
        const anchorContent = await services.skill.getAnchor(local.fqn).catch(() => "");
        closure.set(origin, {
          kind: "skill",
          source: "local",
          node: skillEntityToResolvedNode(
            local,
            anchorContent,
            maps.skillOriginByFqn,
            maps.mcpOriginByFqn,
          ),
        });
        visited.add(origin);
        return;
      }
    }

    inStack.add(origin);
    try {
      const plan = await services.skill.resolve(origin);
      if (plan.conflict !== null) {
        conflicts.push({
          kind: "skill",
          origin: plan.conflict.origin,
          fqn: plan.conflict.fqn,
          reason: plan.conflict.reason,
        });
        return;
      }
      if (plan.node === null) return;
      for (const mcpOrigin of plan.node.depsRefs.mcps) {
        await walkMcp(mcpOrigin);
      }
      for (const skillOrigin of plan.node.depsRefs.skills) {
        await walkSkill(skillOrigin, false);
      }
      closure.set(origin, { kind: "skill", source: "upstream", node: plan.node });
    } finally {
      inStack.delete(origin);
      visited.add(origin);
    }
  }

  async function walkAgent(rawOrigin: string, isRoot: boolean): Promise<void> {
    const origin = safeNormalize(rawOrigin);
    if (inStack.has(origin)) {
      throw new CyclicDependencyError([...inStack, origin]);
    }
    if (visited.has(origin)) return;

    if (opts.mode === "install" && !isRoot) {
      const local = await services.agent.getByOrigin(origin);
      if (local !== null) {
        const maps = await getMaps();
        const anchorContent = await services.agent.getAnchor(local.fqn).catch(() => "");
        closure.set(origin, {
          kind: "agent",
          source: "local",
          node: agentEntityToResolvedNode(
            local,
            anchorContent,
            maps.skillOriginByFqn,
            maps.mcpOriginByFqn,
            maps.agentOriginByFqn,
          ),
        });
        visited.add(origin);
        return;
      }
    }

    inStack.add(origin);
    try {
      const plan = await services.agent.resolve(origin);
      if (plan.conflict !== null) {
        conflicts.push({
          kind: "agent",
          origin: plan.conflict.origin,
          fqn: plan.conflict.fqn,
          reason: plan.conflict.reason,
        });
        return;
      }
      if (plan.node === null) return;
      for (const mcpOrigin of plan.node.depsRefs.mcps) {
        await walkMcp(mcpOrigin);
      }
      for (const skillOrigin of plan.node.depsRefs.skills) {
        await walkSkill(skillOrigin, false);
      }
      for (const agentOrigin of plan.node.depsRefs.agents) {
        await walkAgent(agentOrigin, false);
      }
      closure.set(origin, { kind: "agent", source: "upstream", node: plan.node });
    } finally {
      inStack.delete(origin);
      visited.add(origin);
    }
  }

  async function walkMcp(rawOrigin: string): Promise<void> {
    const origin = safeNormalize(rawOrigin);
    if (visited.has(origin)) return;
    if (opts.mode === "install") {
      const local = await services.mcp.getByOrigin(origin);
      if (local !== null) {
        closure.set(origin, { kind: "mcp", source: "local", node: mcpEntityToResolvedNode(local) });
        visited.add(origin);
        return;
      }
    }
    const result = await services.resolveMcpAdapter(origin);
    if (result.conflict !== null) {
      conflicts.push(result.conflict);
      visited.add(origin);
      return;
    }
    if (result.node === null) {
      visited.add(origin);
      return;
    }
    closure.set(origin, { kind: "mcp", source: "upstream", node: result.node });
    visited.add(origin);
  }

  if (root.kind === "skill") {
    await walkSkill(root.origin, true);
  } else if (root.kind === "agent") {
    await walkAgent(root.origin, true);
  } else {
    await walkMcp(root.origin);
  }

  return { closure, conflicts };
}
