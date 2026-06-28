/**
 * Sync resolve, broken into three independently-testable phases:
 *
 * 1. {@link buildUpstreamClosure} — pure network walk, returns a
 *    `Closure` keyed by origin. Detects cycles. Knows nothing
 *    about local state.
 * 2. {@link buildLocalClosure} — pure DB walk over a seed set,
 *    returns a `Closure` of locally-installed entries. Knows
 *    nothing about upstream.
 * 3. {@link diffClosures} — pure function over the two closures,
 *    produces a `CatalogPlan` (toInstall / alreadyInstalled /
 *    identityChange / orphans).
 *
 * The facade orchestrates: phase 1 → phase 2 → phase 3. Install
 * vs sync diverge only in:
 *   - install: phase 1 may skip subtrees whose root is already
 *     installed (the existing perf optimization)
 *   - sync: phase 1 always re-fetches; phase 3 computes orphans
 *     against the global reverse-dep set
 *
 * Identity-change handling lives entirely in phase 3 — phase 1
 * walks the new upstream tree fully and phase 3 trims to "just
 * the root" when the upstream fqn differs. Slightly wasteful
 * fetch but identity changes are rare and the alternative
 * (phase 1 knowing about identity change) blurs the layering.
 */

export {
  type DiffOptions,
  type DiffResult,
  diffClosures,
} from "./catalog.resolve-pipeline/diff.js";
export { buildLocalClosure } from "./catalog.resolve-pipeline/local.js";
export type {
  Closure,
  ClosureNode,
  ClosureSource,
  PipelineServices,
} from "./catalog.resolve-pipeline/types.js";
export {
  buildUpstreamClosure,
  type UpstreamClosureOpts,
  type UpstreamClosureResult,
} from "./catalog.resolve-pipeline/upstream.js";
