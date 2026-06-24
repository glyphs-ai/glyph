import type { AgentEntity } from "../../agent/agent-entity.js";
import type { AgentResolvedNode } from "../../agent/agent-service.js";
import type { McpEntity } from "../../mcp/mcp-entity.js";
import * as McpFormat from "../../mcp/mcp-format.js";
import type { SkillEntity } from "../../skill/skill-entity.js";
import type { SkillResolvedNode } from "../../skill/skill-service.js";
import type { CatalogPlanNode, McpResolvedNode } from "../plan-types.js";
import type { ClosureNode } from "./types.js";

export function skillEntityToResolvedNode(
  s: SkillEntity,
  anchorContent: string,
  skillOriginByFqn: ReadonlyMap<string, string>,
  mcpOriginByFqn: ReadonlyMap<string, string>,
): SkillResolvedNode {
  return {
    fqn: s.fqn,
    origin: s.origin,
    anchorContent,
    version: s.version,
    depsRefs: {
      skills: s.dependencies.skills.map((d) => skillOriginByFqn.get(d.fqn) ?? "").filter(Boolean),
      mcps: s.dependencies.mcps.map((d) => mcpOriginByFqn.get(d.fqn) ?? "").filter(Boolean),
    },
  };
}

export function agentEntityToResolvedNode(
  a: AgentEntity,
  anchorContent: string,
  skillOriginByFqn: ReadonlyMap<string, string>,
  mcpOriginByFqn: ReadonlyMap<string, string>,
  agentOriginByFqn: ReadonlyMap<string, string>,
): AgentResolvedNode {
  return {
    fqn: a.fqn,
    origin: a.origin,
    anchorContent,
    version: a.version,
    depsRefs: {
      skills: a.dependencies.skills.map((d) => skillOriginByFqn.get(d.fqn) ?? "").filter(Boolean),
      mcps: a.dependencies.mcps.map((d) => mcpOriginByFqn.get(d.fqn) ?? "").filter(Boolean),
      agents: a.dependencies.agents.map((d) => agentOriginByFqn.get(d.fqn) ?? "").filter(Boolean),
    },
  };
}

export function mcpEntityToResolvedNode(m: McpEntity): McpResolvedNode {
  return {
    fqn: m.fqn,
    origin: m.origin,
    content: m.spec,
  };
}

export function buildPlanNode(
  entry: ClosureNode,
  disposition: CatalogPlanNode["disposition"],
  wasAlreadyInstalled: boolean,
  identityChange?: { oldFqn: string; newFqn: string },
): CatalogPlanNode {
  const base = {
    ...(wasAlreadyInstalled ? { wasAlreadyInstalled: true } : {}),
    ...(disposition !== undefined ? { disposition } : {}),
    ...(identityChange !== undefined ? { identityChange } : {}),
  } as const;
  if (entry.kind === "skill") return { kind: "skill", node: entry.node, ...base };
  if (entry.kind === "agent") return { kind: "agent", node: entry.node, ...base };
  return { kind: "mcp", node: entry.node, ...base };
}

export function nodesAreUpToDate(a: ClosureNode, b: ClosureNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.node.fqn !== b.node.fqn) return false;
  if (a.kind === "mcp" && b.kind === "mcp") {
    const localDigest = McpFormat.contentDigestExcludingMeta(a.node.content, `local:${a.node.fqn}`);
    const upstreamDigest = McpFormat.contentDigestExcludingMeta(
      b.node.content,
      `upstream:${b.node.fqn}`,
    );
    if (localDigest === null || upstreamDigest === null) return false;
    return localDigest === upstreamDigest;
  }
  if (a.kind === "mcp" || b.kind === "mcp") return false;
  return a.node.version === b.node.version;
}
