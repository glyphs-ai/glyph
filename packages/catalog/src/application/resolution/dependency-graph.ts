/**
 * The dependency-graph domain model. A catalog IS a dependency graph of
 * skills / agents / mcps; resolving and diffing that graph is core domain
 * vocabulary, independent of any single use-case.
 *
 * A `ResolvedGraph` is the deduped reachable closure from a root: one
 * `ResolvedNode` per origin plus the `CatalogConflict`s for nodes that
 * couldn't enter (a source fetch/parse failure, or an origin conflict with
 * an already-installed entry). The application
 * services `get-tree` (installed graph, from repos) and `get-upstream-tree`
 * (source graph, from upstream manifests) are PARALLEL producers that each
 * populate this same model — they depend on this domain model, never on
 * each other.
 *
 * Graphs key on `origin` (fqns can collide across kinds, origins cannot);
 * Entities and manifests hold deps as verbatim origins, so a resolved node
 * needs no fqn→origin map.
 */

import { z } from "zod";
import { CatalogKindSchema } from "../../domain/catalog-kind.js";

const resolvedNodeDependencyRefs = z.object({
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  agents: z.array(z.string()),
});

export const EMPTY_DEP_REFS = { skills: [], mcps: [], agents: [] };

export const ResolvedNodeSchema = z.object({
  kind: CatalogKindSchema,
  origin: z.string(),
  fqn: z.string(),
  /** skill/agent semver; mcps have none — version is "" and content drives diff. */
  version: z.string(),
  /** mcp spec bytes; "" for skill/agent (version drives their diff). */
  content: z.string(),
  /** Verbatim dep origins; agents[] empty for skill, all empty for mcp. */
  dependencyRefs: resolvedNodeDependencyRefs,
});
export type ResolvedNode = z.infer<typeof ResolvedNodeSchema>;

const conflictReason = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fetch-failed"), cause: z.unknown() }),
  z.object({ kind: z.literal("parse-failed"), cause: z.unknown() }),
  z.object({ kind: z.literal("origin-conflict"), existingOrigin: z.string() }),
]);

/** A node that couldn't enter the graph — a source fetch/parse failure or an origin conflict. */
export const ConflictSchema = z.object({
  kind: CatalogKindSchema,
  origin: z.string(),
  fqn: z.string().nullable(),
  reason: conflictReason,
});
export type CatalogConflict = z.infer<typeof ConflictSchema>;

/** Deduped reachable graph: one node per origin + verbatim dep edges. */
export const ResolvedGraphSchema = z.object({
  nodes: z.array(ResolvedNodeSchema),
  conflicts: z.array(ConflictSchema),
});
export type ResolvedGraph = z.infer<typeof ResolvedGraphSchema>;
