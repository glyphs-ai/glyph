/**
 * Consumer-owned port contracts for @glyphs-ai/task. Catalog
 * structurally satisfies `AgentResolverPort` so the task pkg does not
 * need to depend on `@glyphs-ai/catalog` directly; any object
 * satisfying these shapes works.
 *
 * Catalog's CatalogService, AgentResolveResult, BlockedReason, etc.
 * satisfy these interfaces structurally, so production wiring passes
 * catalog values without any adapter layer.
 *
 * Not-found discrimination is via `null` return from `getAgentEntry`,
 * NEVER via a typed `instanceof CatalogAgentNotFoundError` check.
 * The port deliberately exposes no error class — any error thrown
 * by `resolveAgent` is treated as a 500 by `resolveDispatchAgent`.
 */

import type { ResolvedAgent } from "@glyphs-ai/runtime";

export interface AgentEntry {
  readonly status: "ready" | "blocked";
  readonly blockedReason?: BlockedReason | undefined;
}

export interface BlockedReason {
  readonly needsPrereqsAck?: true;
  readonly disabledByUser?: true;
  readonly orphaned?: true;
  readonly missingDeps?: readonly MissingDep[];
  readonly blockedDeps?: readonly BlockedDep[];
}

/**
 * Structural port for missing dependencies. The only consumer
 * (`summariseReason`) reads `missingDeps.length` — i.e. the count of
 * the containing array, never individual element fields. `unknown`
 * accepts catalog's wider `{ kind, name }` shape without having to
 * list those fields here.
 */
export type MissingDep = unknown;

/** summariseReason reads `d.fqn`. Catalog's wider `{ kind, fqn }` satisfies. */
export interface BlockedDep {
  readonly fqn: string;
}

export interface AgentResolverPort {
  getAgentEntry(name: string): Promise<AgentEntry | null>;
  resolveAgent(name: string): Promise<ResolvedAgent>;
}
