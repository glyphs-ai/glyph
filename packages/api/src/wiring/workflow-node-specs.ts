/**
 * Worker-kind node spec payload. Flat, matches the body shape minus
 * the discriminator. Persisted opaquely as `workflow_nodes.spec_json`
 * via the substrate's envelope; consumed flatly on the wire.
 *
 * The worker-kind handler enforces (at insert time):
 *
 *   1. `agent` non-empty string AND exists in the catalog.
 *   2. `brief` non-empty string, no `\n`/`\r`, length ≤ 200 (matches
 *      `@glyphs-ai/task` `DispatchOpts.brief`).
 *   3. `details` when present, must be string (empty allowed).
 *   4. `runtime` when present, must be non-empty string.
 */
export interface WorkflowWorkerNodeSpec {
  /** Worker agent FQN. */
  readonly agent: string;
  /** Worker brief: single line, ≤ 200 chars (no `\n` / `\r`). */
  readonly brief: string;
  /** Optional multi-line context for the worker. */
  readonly details?: string;
  /** Optional runtime override (e.g. `bash`, `python`). Non-empty when present. */
  readonly runtime?: string;
}

/**
 * Coordinator-kind node spec payload. Every coordinator node carries
 * its own agent FQN — the workflow's `coordinator_agent` header
 * column is just a denorm cache of the most-recently-created coord
 * node's `spec.agent`.
 *
 * The silent-retry path (the substrate's auto-respawn when a coord
 * exits without making forward progress) copies the predecessor's
 * `spec_json` verbatim, so a retry is byte-identical to its
 * predecessor. When a coord schedules a new successor explicitly,
 * the coord chooses what agent to use — inheriting the same agent
 * is convention, not enforced.
 *
 * The coordinator-kind handler enforces (at insert time):
 *
 *   1. `agent` non-empty string AND exists in catalog AND its
 *      `dependencies.agents` dispatch menu MUST be non-empty.
 */
export interface WorkflowCoordinatorNodeSpec {
  /** Coordinator agent FQN. */
  readonly agent: string;
}
