import type { ResolvedAgent } from "@glyphs-ai/runtime";
import type { ResultAsync } from "neverthrow";

/** `create`: the agent name does not resolve to a catalog entry. */
export type AgentNotFound = {
  readonly type: "AgentNotFound";
  readonly agent: string;
};

/** `create`: the catalog faulted while resolving the agent (not "absent"). */
export type AgentUnresolvable = {
  readonly type: "AgentUnresolvable";
  readonly agent: string;
  readonly cause: unknown;
};

/**
 * Resolves a catalog agent at session-create time. Satisfied at the
 * composition root by an adapter over `@glyphs-ai/catalog` (session
 * never imports catalog). `resolve` yields `AgentNotFound` when the
 * name is absent and `AgentUnresolvable` when the catalog itself
 * faults.
 */
export interface AgentResolver {
  resolve(agent: string): ResultAsync<ResolvedAgent, AgentNotFound | AgentUnresolvable>;
}
