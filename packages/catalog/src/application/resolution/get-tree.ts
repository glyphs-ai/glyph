/**
 * Use case: walk the INSTALLED graph from a seed origin and return the deduped
 * reachable graph. Persisted dependency rows are fqn-based; the graph surface is
 * origin-based so it can be diffed against upstream manifests.
 *
 * The walk is entirely read-side: it runs synchronously inside one
 * `CatalogQueries.query` lambda (better-sqlite3 is synchronous), so a driver
 * fault surfaces once as `DatabaseUnavailable`.
 */

import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { Db } from "../../infrastructure/drizzle/catalog-db.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectAgentByFqn, selectAgentByOrigin } from "../agent/agent-reads.js";
import { selectMcpByFqn, selectMcpByOrigin } from "../mcp/mcp-reads.js";
import { selectSkillByFqn, selectSkillByOrigin } from "../skill/skill-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { EMPTY_DEP_REFS, ResolvedGraphSchema, type ResolvedNode } from "./dependency-graph.js";

export const GetTreeRequestSchema = z.object({ origin: z.string() });
export type GetTreeRequest = z.infer<typeof GetTreeRequestSchema>;

export const GetTreeResponseSchema = ResolvedGraphSchema;
export type GetTreeResponse = z.infer<typeof GetTreeResponseSchema>;

export type GetTreeError = DatabaseUnavailable;

export interface GetTreeDeps {
  readonly queries: CatalogQueries;
}

export class GetTreeUseCase implements UseCase<GetTreeRequest, GetTreeResponse, GetTreeError> {
  constructor(private readonly deps: GetTreeDeps) {}

  execute(request: GetTreeRequest): UseCaseResult<GetTreeResponse, GetTreeError> {
    const seed = request.origin;
    return this.deps.queries.query((db): GetTreeResponse => {
      const nodes = new Map<string, ResolvedNode>();
      const visited = new Set<string>();
      const visit = (origin: string): void => {
        if (visited.has(origin)) return;
        visited.add(origin);
        const node = loadNode(db, origin);
        if (node === null) return;
        nodes.set(origin, node);
        for (const depOrigin of [
          ...node.dependencyRefs.mcps,
          ...node.dependencyRefs.skills,
          ...node.dependencyRefs.agents,
        ]) {
          visit(depOrigin);
        }
      };
      visit(seed);
      return { nodes: [...nodes.values()], conflicts: [] };
    });
  }
}

/** Resolve an origin to its installed node, trying agent → skill → mcp. */
function loadNode(db: Db, origin: string): ResolvedNode | null {
  const agent = selectAgentByOrigin(db, origin);
  if (agent !== undefined) {
    return {
      kind: "agent",
      origin,
      fqn: agent.fqn,
      version: agent.version,
      content: "",
      dependencyRefs: {
        skills: skillOrigins(db, agent.dependencyRefs.skills),
        mcps: mcpOrigins(db, agent.dependencyRefs.mcps),
        agents: agentOrigins(db, agent.dependencyRefs.agents),
      },
    };
  }
  const skill = selectSkillByOrigin(db, origin);
  if (skill !== undefined) {
    return {
      kind: "skill",
      origin,
      fqn: skill.fqn,
      version: skill.version,
      content: "",
      dependencyRefs: {
        skills: skillOrigins(db, skill.dependencyRefs.skills),
        mcps: mcpOrigins(db, skill.dependencyRefs.mcps),
        agents: [],
      },
    };
  }
  const mcp = selectMcpByOrigin(db, origin);
  if (mcp !== undefined) {
    return {
      kind: "mcp",
      origin,
      fqn: mcp.fqn,
      version: "",
      content: mcp.spec,
      dependencyRefs: EMPTY_DEP_REFS,
    };
  }
  return null;
}

/** Map dependency fqns to their installed origins; unresolved fqns pass through. */
function skillOrigins(db: Db, fqns: readonly string[]): string[] {
  return fqns.map((fqn) => selectSkillByFqn(db, fqn)?.origin ?? fqn);
}

function mcpOrigins(db: Db, fqns: readonly string[]): string[] {
  return fqns.map((fqn) => selectMcpByFqn(db, fqn)?.origin ?? fqn);
}

function agentOrigins(db: Db, fqns: readonly string[]): string[] {
  return fqns.map((fqn) => selectAgentByFqn(db, fqn)?.origin ?? fqn);
}
