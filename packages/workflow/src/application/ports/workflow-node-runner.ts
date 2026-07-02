/**
 * Throw-based runner port for untrusted injected IO. The shipping runner
 * implementations live in `packages/api/src/wiring/` and bridge to
 * `@glyphs-ai/task` plus `@glyphs-ai/catalog`, which throw today; application
 * use-cases wrap this boundary with `ResultAsync.fromPromise(...)` and translate
 * thrown validation failures into domain atoms at the call site. Keeping this
 * port throw-based avoids adapter churn while preserving Result-native
 * application boundaries.
 */

import type { WorkflowNodeKind } from "../../domain/node/workflow-node-kind.js";
import type { WorkflowStatus } from "../../domain/workflow/workflow-status.js";

/**
 * Context threaded into `WorkflowNodeRunner.validate`. Carries the
 * workflow id, the workflow's current status, and the workflow's
 * coordinator agent FQN so per-kind runners can do cross-workflow-state
 * and capability checks if needed; the substrate stays kind-agnostic
 * and does NOT pass any caller identity. Runners that need to check
 * catalog references on `spec` do so against the catalog directly.
 *
 * For ordinary mutation paths the substrate calls `validate` with
 * `workflowStatus: 'running'` (mutations are only legal on running
 * workflows). The bootstrap path inside `createWorkflow` also passes
 * `'running'` because the new workflow is constructed in that state.
 */
export interface WorkflowNodeValidateCtx {
  readonly workflowId: string;
  /**
   * Workflow status at the time `validate` is called. Always
   * `'running'` for ordinary mutations — the substrate refuses
   * mutations on terminal workflows before `validate` runs.
   */
  readonly workflowStatus: WorkflowStatus;
  /**
   * FQN of the workflow's coordinator agent (denormalized from
   * `workflow.coordinator_agent`). Threaded so per-kind runners can
   * enforce capability rules against the coord's
   * `dependencies.agents` dispatch menu.
   *
   * For the bootstrap `createWorkflow` path this is `args.coordinatorAgent`
   * (the agent about to be installed as coord); for every subsequent
   * add / replace path it's read from the existing workflow row.
   */
  readonly coordinatorAgent: string;
}

/**
 * Outcome reported by a runner once the unit-of-work backing a
 * dispatched node has reached a terminal state. The runner observes
 * the outcome (e.g. by polling its task store, or by being driven by
 * an in-process event) and calls the `onTerminal` callback supplied
 * to {@link WorkflowNodeRunner.dispatch}, which lets the engine mark
 * the substrate's node terminal and re-evaluate downstream readiness.
 *
 * The discriminated union is intentionally narrow: the substrate only
 * cares about *which terminal state* the node should land in, plus a
 * human-readable `reason` for the `failed` / `cancelled` arms. `output`
 * is a runner-supplied opaque blob (e.g. exit code, runtime metadata)
 * that the substrate currently logs at debug — it does NOT
 * denormalize it into the `workflow_nodes` row, because that would
 * couple the substrate to per-runner payload shapes. (Result data
 * proper lives on the unit-of-work side, e.g. `tasks.result_json`.)
 *
 * The `cancelled.reason` field follows the same convention as
 * `failed.reason`: the runner supplies a short human-readable phrase
 * that the dashboard renders via the joined task entity (the
 * substrate stays kind-agnostic and does not persist the reason on
 * the workflow node row itself — per-kind units of work are where
 * it lands).
 */
export type WorkflowNodeTerminalResult =
  | { readonly status: "succeeded"; readonly output?: unknown }
  | { readonly status: "failed"; readonly reason: string; readonly output?: unknown }
  | { readonly status: "cancelled"; readonly reason: string };

export interface WorkflowNodeDispatchOpts {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly spec: unknown;
  readonly onTerminal: (result: WorkflowNodeTerminalResult) => void;
}

/**
 * Per-kind runner injected at compose time via the `runners`
 * parameter to `composeWorkflowModule`. The substrate has built-in
 * knowledge of the closed kind enum (`'coordinator' | 'worker'`) and
 * of kind-aware semantic rules (e.g. per-kind parent-readiness, the
 * single-coord-successor rule, the orphan-coord rule, the
 * `workflows.coordinator_agent` denorm sync), but does NOT know HOW
 * each kind dispatches or what spec shape each kind requires — both
 * are runner concerns.
 *
 * No capabilities flag on the interface: coord-special behaviors
 * (the mutation auth gate, silent-retry detection, the
 * `workflows.coordinator_agent` denorm sync) are encoded in the
 * engine itself, not routed through a polymorphic interface method.
 * That keeps the runner interface intentionally minimal — validate
 * / dispatch / hasInFlightForNode / cancel — and means a new kind
 * only has to answer those four questions.
 *
 * Concrete runners live wherever they bridge the substrate to its
 * mechanism (e.g. `packages/api/src/wiring/` for the shipping
 * coordinator/worker runners that adapt `@glyphs-ai/task` +
 * `@glyphs-ai/catalog` to this interface). The substrate pkg itself
 * never imports any of its callers.
 */
export interface WorkflowNodeRunner {
  /**
   * Validate an inbound `spec` payload. MUST throw on invalid shape;
   * MAY perform async side-effects (e.g. catalog existence lookup
   * for an agent FQN). Returns the validated / normalized payload,
   * which the substrate persists as `spec_json`. Implementations are
   * free to normalize (trim, drop unknown keys); the returned value
   * is what gets stored.
   */
  validate(spec: unknown, ctx: WorkflowNodeValidateCtx): Promise<unknown>;

  /**
   * Fire the unit of work backing this node. Called by the substrate
   * when the node transitions `not_started|ready → running`. The
   * runner dispatches whatever it needs (e.g. a task) and stamps the
   * node id into the unit's typed `origin_id` column (alongside
   * `origin: "workflow"`) so the reverse-lookup partial index engages.
   *
   * The runner MUST invoke `opts.onTerminal` exactly once per dispatch
   * when (and only when) it has observed a terminal outcome
   * (`succeeded` / `failed` / `cancelled`) for the unit of work
   * backing this dispatch call. The engine threads this callback
   * through so the substrate can mark the node terminal and
   * re-evaluate downstream readiness without the runner having to
   * know about service plumbing. `onTerminal` is idempotent on the
   * service side — re-invoking it is a no-op once the node is
   * terminal — but runners SHOULD avoid double-calling because it
   * costs a redundant tx.
   *
   * `onTerminal` MAY be invoked synchronously inside `dispatch`
   * (zero-latency runners) or asynchronously after `dispatch` has
   * already returned. The engine commits the `ready → running`
   * transition BEFORE calling `dispatch`, so the substrate's row is
   * always in the right state when `onTerminal` fires.
   *
   * The runner SHOULD log its substrate-side identifier (e.g. task
   * id) at info level inside `dispatch` so operators can correlate
   * substrate events with the unit-of-work. The substrate itself
   * does NOT persist that id — reverse lookup goes through the unit's
   * typed `(origin, origin_id)` column pair (e.g. a task with
   * `origin: "workflow"` and `origin_id` = the node id), not
   * through a `workflow_nodes` column. (Persisting it would create a
   * denorm the substrate would have to keep in sync with the
   * unit-of-work side.)
   */
  dispatch(opts: WorkflowNodeDispatchOpts): Promise<void>;

  /**
   * Whether this kind currently has a dispatched-but-incomplete
   * unit-of-work for `nodeId`. Used by cancel reconciliation AND by
   * engine-restart recovery (`running` rows with no in-flight unit
   * get rolled back to `ready`).
   */
  hasInFlightForNode(nodeId: string): Promise<boolean>;

  /**
   * Cancel the in-flight unit-of-work for `nodeId`. Idempotent;
   * best-effort. Cancellation semantically means "the substrate will
   * ignore the unit's eventual outcome", NOT proof that the unit has
   * actually stopped — the unit may still complete after the cancel
   * returns, and its result will simply be discarded.
   */
  cancel(nodeId: string): Promise<void>;
}

/**
 * Compose-time wiring: one runner per substrate kind. Required by
 * `composeWorkflowModule`; all fields are non-optional so a missing
 * runner is a TypeScript compile error rather than a runtime throw.
 *
 * Adding a new kind to {@link WorkflowNodeKind} forces a matching field to
 * appear here — TypeScript's exhaustiveness propagates to every
 * `switch (kind)` over `WorkflowNodeKind` in the substrate, so missing the
 * new runner cannot ship.
 */
export interface WorkflowRunners {
  readonly coordinator: WorkflowNodeRunner;
  readonly worker: WorkflowNodeRunner;
  readonly human: WorkflowNodeRunner;
}

/** Resolve the runner for a closed `WorkflowNodeKind`. */
export function runnerFor(runners: WorkflowRunners, kind: WorkflowNodeKind): WorkflowNodeRunner {
  return runners[kind];
}
