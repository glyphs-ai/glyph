import type { AgentResolvedNode, AgentService } from "../../agent/agent-service.js";
import type { McpService } from "../../mcp/mcp-service.js";
import type { SkillResolvedNode, SkillService } from "../../skill/skill-service.js";
import type { CatalogConflict, McpResolvedNode } from "../plan-types.js";

/**
 * One node in a {@link Closure}. Discriminated by `kind`; the
 * payload reuses the existing per-kind ResolvedNode shapes so
 * we don't introduce a parallel type hierarchy.
 *
 * `source` distinguishes whether this node came from upstream
 * (phase 1) or local DB (phase 2). The diff phase uses this to
 * decide which nodes need fetching/installing vs already-on-disk.
 */
export type ClosureNode =
  | { readonly kind: "skill"; readonly source: ClosureSource; readonly node: SkillResolvedNode }
  | { readonly kind: "agent"; readonly source: ClosureSource; readonly node: AgentResolvedNode }
  | { readonly kind: "mcp"; readonly source: ClosureSource; readonly node: McpResolvedNode };

export type ClosureSource = "upstream" | "local";

/**
 * Map of origin → node. A closure represents a snapshot of the
 * dep graph reachable from some root, keyed by origin (the only
 * cross-kind identifier — fqns can collide across kinds in
 * principle, origins cannot).
 */
export type Closure = ReadonlyMap<string, ClosureNode>;

/**
 * Bundle of services + adapters the phases need. Kept as a single
 * record so call sites pass one argument instead of N positional.
 */
export interface PipelineServices {
  readonly skill: SkillService;
  readonly agent: AgentService;
  readonly mcp: McpService;
  /** Origin → resolved MCP node (same contract as {@link McpResolveAdapter}). */
  readonly resolveMcpAdapter: (origin: string) => Promise<{
    node: McpResolvedNode | null;
    conflict: CatalogConflict | null;
  }>;
}
