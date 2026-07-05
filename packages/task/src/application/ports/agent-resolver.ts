import type { ResolvedAgent } from "@glyphs-ai/runtime";
import type { ResultAsync } from "neverthrow";

/** `dispatch`: the agent name does not resolve to a catalog entry. */
export type AgentNotFound = {
  readonly type: "AgentNotFound";
  readonly agent: string;
};

/** `dispatch`: the catalog faulted while resolving the agent (not "absent"). */
export type AgentResolutionFailed = {
  readonly type: "AgentResolutionFailed";
  readonly agent: string;
  readonly cause: unknown;
};

/** Readiness of a catalog agent, read at dispatch time. */
export interface AgentEntry {
  readonly status: "ready" | "blocked";
  readonly blockedReason?: BlockedReason | undefined;
}

/**
 * Why an agent (or one of its transitive deps) is blocked. Carried by
 * `EntryNotReady` so callers can render a useful "here's what to fix"
 * message. Fields are structural so catalog's wider shapes satisfy them.
 */
export interface BlockedReason {
  readonly needsPrereqsAck?: true;
  readonly disabledByUser?: true;
  readonly orphaned?: true;
  readonly missingDeps?: readonly unknown[];
  readonly blockedDeps?: readonly { readonly fqn: string }[];
}

/**
 * Resolves a catalog agent at dispatch time. Satisfied at the composition
 * root by an adapter over `@glyphs-ai/catalog` (task never imports
 * catalog). `resolve` yields `AgentNotFound` when the name is absent and
 * `AgentResolutionFailed` when the catalog itself faults; `getEntry`
 * returns the readiness entry (`null` when absent).
 */
export interface AgentResolver {
  resolve(agent: string): ResultAsync<ResolvedAgent, AgentNotFound | AgentResolutionFailed>;
  getEntry(agent: string): ResultAsync<AgentEntry | null, AgentResolutionFailed>;
}
