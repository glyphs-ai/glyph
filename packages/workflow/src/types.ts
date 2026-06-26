/**
 * Public types for `@glyphs-ai/workflow`.
 *
 * The workflow pkg is a substrate over a closed kind enum: it stores
 * `workflow_nodes` rows with a `{ kind: WorkflowNodeKind, spec: unknown }`
 * envelope and routes every kind-aware operation (validate, dispatch,
 * in-flight check, cancel) through a {@link WorkflowNodeRunner}
 * injected at compose time. The substrate has compile-time knowledge
 * of the kind set (`'coordinator' | 'worker'`) and of kind-aware
 * semantic rules, but does NOT know HOW each kind dispatches or what
 * spec shape each kind requires — those are runner concerns.
 *
 * Per-kind wire DTOs (`WorkflowWorkerNodeSpec`,
 * `WorkflowCoordinatorNodeSpec`, `WorkflowNodeSpec`, …) live in
 * `@glyphs-ai/api`'s wire surface; this file owns only substrate-side types
 * (`WorkflowNodeKind`, `WorkflowStatus`, `WorkflowNodeStatus`,
 * `WorkflowNodeSpecEnvelope`, `WorkflowNodeValidateCtx`,
 * `WorkflowNodeDispatchOpts`, `WorkflowNodeRunner`,
 * `WorkflowRunners`, and the two derived-view helpers
 * `hasLiveCoord` / `deriveIterationCount`).
 */

import type { WorkflowEdgeEntity, WorkflowEntity, WorkflowNodeEntity } from "./workflow-entity.js";

// ─── FSM enums ──────────────────────────────────────────────────────

/**
 * Workflow-level FSM. Four values, exactly one non-terminal
 * (`running`). The substrate deliberately does NOT persist a separate
 * "actively coordinating right now" status — that's derived from
 * `workflow_nodes` (any `coordinator`-kind node with `status =
 * 'running'`); see {@link hasLiveCoord}.
 *
 * Forward-only: once a workflow hits a terminal status, no further
 * status mutation is allowed.
 */
export type WorkflowStatus = "running" | "succeeded" | "failed" | "cancelled";

// ─── Origin discriminator ───────────────────────────────────────────

/**
 * Who launched this workflow. Mirrors `TaskOrigin` from
 * `@glyphs-ai/task`. The discriminator partitions workflows into
 * disjoint surfaces — `GET /workflows` returns only `"standalone"`,
 * while origin-specific routes return their respective subset.
 *
 *   - `standalone` — created directly by a user via the dashboard,
 *     CLI, or MCP call.
 *   - `schedule` — created by an integration handler.
 */
export type WorkflowOrigin = "standalone" | "schedule";

// ─── Terminal payloads ──────────────────────────────────────────────

/**
 * Payload attached when a workflow transitions to `succeeded`. Set
 * by the coord's `finishWorkflow({outcome:'succeeded', success})`
 * call. `output` is the coord's free-text summary of the run — what
 * gets rendered as the "Summary" card on the dashboard Overview
 * tab. Coord MAY pass `null` (or omit `output` entirely → defaults
 * to null) when the workflow has no meaningful summary to show.
 *
 * No `artifacts` field — workflow artifacts live durably under
 * `<workflowDir>/artifact/` and are discovered via the
 * `/artifacts` listing route. There's no workdir-cleanup concern
 * the task analog protects against.
 */
export interface WorkflowSuccess {
  readonly output: string | null;
}

/**
 * Payload attached when a workflow transitions to `failed`.
 *
 * Discriminated on `kind`:
 *
 *   - `coordinator` — set by the coordinator's
 *     `finishWorkflow({outcome:'failed', failure})` call. The
 *     coordinator supplies the human-readable `message`.
 *   - `substrate` — set by the substrate itself when an internal
 *     safety net trips. Carries a closed `reason` code plus a
 *     human-readable `message`; coord-side callers can never
 *     construct this arm (external entry points reject anything but
 *     `kind: 'coordinator'`).
 *
 * `message` is the human-readable summary the dashboard renders for
 * both arms.
 */
export type WorkflowFailure =
  | {
      readonly kind: "coordinator";
      readonly message: string;
    }
  | {
      readonly kind: "substrate";
      /**
       * Closed set of substrate-detected failure codes. The sole
       * current value is `"STUCK_RETRY_LIMIT"` — the stuck-coord
       * detector inserted {@link STUCK_RETRY_MAX_ATTEMPTS} consecutive
       * retry coords without the workflow making forward progress, so
       * the substrate gave up and transitioned the workflow terminal
       * to stop holding the slot open. Widen this union (plus the
       * `SUBSTRATE_FAILURE_REASONS` guard in `validate.ts` and the
       * `STUCK_RETRY_LIMIT` const in `_stuck-recovery.ts`) when a new
       * substrate failure mode is added. See
       * {@link WorkflowService.checkStuckAndRecoverInTx} for the
       * trigger.
       */
      readonly reason: "STUCK_RETRY_LIMIT";
      readonly message: string;
    };

/**
 * Payload attached when a workflow transitions to `cancelled`. Set
 * by the cancelWorkflow route.
 *
 * Single-arm interface — `kind` is retained as a discriminator.
 *
 *   - `user` — operator called cancelWorkflow via dashboard / CLI.
 */
export type WorkflowCancellation = {
  readonly kind: "user";
  readonly message: string;
};

/**
 * Per-node FSM. Same vocabulary applies to BOTH worker-kind and
 * coordinator-kind nodes.
 *
 *   not_started ─ready─► ready ─launch─► running ─done────► succeeded
 *                                                └─fail────► failed
 *
 * `cancelled` is the cancel terminal, legal from `not_started`,
 * `ready`, or `running` for worker-kind only. Coordinator-kind nodes
 * are never cancelled directly — workflow-level cancellation goes
 * through `cancelWorkflow`, which cascades.
 */
export type WorkflowNodeStatus =
  | "not_started"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

// ─── Closed kind enum ───────────────────────────────────────────────

/**
 * Closed enum of substrate-supported node roles. `'coordinator'` is
 * the conductor that mutates the DAG; `'worker'` is a unit of work
 * dispatched by a coordinator. The set is fixed at compile time —
 * adding a new role (e.g. `'human'` for approval gates) requires
 * extending this literal union AND adding a matching field on
 * {@link WorkflowRunners}; TypeScript catches any unhandled case as
 * a compile error.
 *
 * The string values `"coordinator"` / `"worker"` are also the
 * persisted `workflow_nodes.kind` column values; the substrate's
 * defensive {@link WorkflowNodeKindCorruptionError} only fires when a
 * persisted row carries a value outside this union (schema
 * corruption).
 */
export type WorkflowNodeKind = "coordinator" | "worker" | "human";

// ─── Node metadata: retry-coord recovery ─────────────────────────────

/**
 * Closed enum of substrate-internal reasons the stuck-coord detector
 * inserts a retry coordinator node. Stored on the retry coord's
 * `metadata.retry.reason`. New reasons require a typed schema bump —
 * the literal-union forces every coord-side prompt branch to handle
 * the new case explicitly.
 *
 *   - `coord_exited_without_action` — the previous coord terminated
 *     with no `add-subgraph` / `finish` call; the workflow's leaf
 *     frontier collapsed to that lone terminal coord.
 *   - `workers_finished_without_coord` — the previous coord planned
 *     worker(s) but never planned a follow-up coord; all workers have
 *     now terminated and no coord is at the leaf frontier.
 */
export type WorkflowNodeRetryReason =
  | "coord_exited_without_action"
  | "workers_finished_without_coord";

/**
 * Shape persisted on a retry coord's `metadata.retry`. The block
 * always exists in full when present; partial blocks (e.g. an `of`
 * with no `reason`) are treated as absent by
 * {@link extractWorkflowNodeRetryMetadata}.
 *
 *   - `of` — id of the previous coord that failed to make forward
 *     progress. NOT necessarily a structural parent in every case —
 *     in `workers_finished_without_coord` the retry's structural
 *     parents include both the failing coord AND the terminal workers.
 *   - `reason` — see {@link WorkflowNodeRetryReason}.
 *   - `attempt` — 1-based consecutive-retry counter (chains across
 *     both reasons until a normally-terminated coord breaks the chain
 *     by carrying no `metadata.retry` block).
 */
export type WorkflowNodeRetryMetadata = {
  readonly of: string;
  readonly reason: WorkflowNodeRetryReason;
  readonly attempt: number;
};

// ─── Derived-view helpers (NOT persisted) ───────────────────────────

/**
 * "Is there a coordinator actively running right now?" Pure derived
 * predicate over the node set — there is intentionally no workflow-
 * column equivalent, because making this stateful would mean every
 * coord wake/sleep had to update two rows transactionally and the
 * substrate would silently drift if the second write failed.
 *
 * Pure function; safe to call from anywhere (SPA, CLI, server).
 */
export function hasLiveCoord(
  nodes: ReadonlyArray<{
    readonly kind: string;
    readonly status: WorkflowNodeStatus;
  }>,
): boolean {
  return nodes.some((n) => n.kind === "coordinator" && n.status === "running");
}

/**
 * Iteration count — the number of coordinator-kind nodes ever
 * created in this workflow. UI / CLI use it to render "Iteration N"
 * labels. Silent-retry coord nodes (the substrate's automatic
 * respawn when a coord exits without making forward progress) ARE
 * counted: from the user's perspective, a retry IS another
 * iteration.
 *
 * Pure function over a pre-computed count; the workflow pkg's
 * service layer provides a one-shot SQL to get the count.
 */
export function deriveIterationCount(coordNodeCount: number): number {
  return coordNodeCount;
}

// ─── Runner substrate interface ─────────────────────────────────────

/**
 * Opaque envelope persisted by the workflow pkg for every node. The
 * `spec` payload is `unknown` because the substrate deliberately
 * doesn't know per-kind shape; the injected per-kind
 * {@link WorkflowNodeRunner} owns parsing / validation / dispatch /
 * in-flight check / cancel.
 *
 * On disk: `kind` lives in `workflow_nodes.kind` and `spec` is
 * `JSON.stringify`ed into `workflow_nodes.spec_json`. The kind is
 * NOT redundantly nested inside `spec_json`.
 */
export interface WorkflowNodeSpecEnvelope {
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
}

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
  readonly nodeDir: string;
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
   * runner dispatches whatever it needs (e.g. a task) and stamps
   * `{ workflowId, workflowNodeId }` into the unit's metadata so the
   * reverse-lookup partial indexes engage.
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
   * does NOT persist that id — reverse lookup goes through the
   * unit's metadata (e.g. `task.metadata.workflowNodeId`), not
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
 * `composeWorkflowModule`; both fields are non-optional so a missing
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

// ─── Human-node types ───────────────────────────────────────────────

/** Maximum number of user-supplied choices on a human node spec. */
export const HUMAN_MAX_CHOICES = 5;

/**
 * One selectable choice on a human node. `id` must be a non-empty
 * string unique within the spec's choices array.
 */
export interface HumanNodeChoice {
  readonly id: string;
  readonly label: string;
}

/**
 * Spec shape for a `human`-kind workflow node. Declared by the
 * coordinator via `add-subgraph` to insert a gate that waits for
 * external human input.
 *
 *   - `prompt` — required non-empty string shown to the human.
 *   - `promptStyle` — required rendering hint for `prompt`. Coord MUST
 *     consciously declare format on every human-node insertion.
 *     Renderers dispatch:
 *       - `"plain"` — literal text (whitespace-folded by HTML normal
 *         rules); choose for single-sentence prompts and any text
 *         that contains characters a markdown renderer would
 *         interpret (asterisks, backticks, underscores in identifiers).
 *       - `"markdown"` — block elements via the dashboard's in-house
 *         renderer (headings / lists / code blocks / inline emphasis /
 *         safe links). Choose whenever the prompt uses any formatting.
 *     Future styles MAY be added; consumers MUST handle the union
 *     exhaustively.
 *   - `choices` — optional array of up to {@link HUMAN_MAX_CHOICES}
 *     selectable options. An omitted or empty array means freeform-only.
 */
export interface HumanNodeSpec {
  readonly prompt: string;
  readonly promptStyle: HumanNodePromptStyle;
  readonly choices?: readonly HumanNodeChoice[];
}

/**
 * Closed enum of supported prompt rendering styles on
 * {@link HumanNodeSpec.promptStyle}. Extending the union is a
 * backward-compatible schema change as long as renderers continue to
 * fall back to `"plain"` for unknown values.
 */
export type HumanNodePromptStyle = "plain" | "markdown";

/** All valid {@link HumanNodePromptStyle} values; used by validators. */
export const HUMAN_PROMPT_STYLES: readonly HumanNodePromptStyle[] = ["plain", "markdown"];

/**
 * Response shape written into `node.metadata.response` when a human
 * responds to a human-kind node via the respond API.
 *
 *   - `choiceId` — the selected choice id (must match one of
 *     `spec.choices[].id`). When absent, the response is freeform.
 *   - `input` — freeform text; required when `choiceId` is absent,
 *     optional otherwise.
 */
export interface HumanNodeResponse {
  readonly choiceId?: string;
  readonly input?: string;
}

// ─── addSubgraph node references ────────────────────────────────────

/**
 * Discriminated-union reference to a node in an `addSubgraph` edge:
 *
 *   - `kind: "existing"`: real node id already persisted in this
 *     workflow.
 *   - `kind: "temp"`: a `tempId` declared in the batch's `nodes[]`,
 *     resolved to a real id during topology assignment.
 *
 * Lives in `types.ts` (the pkg's public type module) so both the
 * pure `_dag.ts` helpers and the service-facing `AddSubgraphEdgeInput`
 * DTO can reference it without a cross-module import edge, and the
 * public `index.ts` re-export can pick it up directly.
 */
export type NodeRef =
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "temp"; readonly tempId: string };

// ─── Service request / response DTOs ────────────────────────────────
//
// Option + result shapes for the WorkflowService mutation primitives
// and reads. Kept here (rather than inline in workflow-service.ts) so
// the public surface lives in one place and cross-package callers
// import wire shapes without dragging in the service module. The
// constructor-wiring shapes (WorkflowServiceOpts, WorkflowEngineLike)
// deliberately stay next to the class.

export interface CreateWorkflowOpts {
  readonly brief: string;
  readonly details?: string;
  readonly coordinatorAgent: string;
  /**
   * Who launched this workflow. Defaults to `"standalone"` when omitted
   * (direct dashboard / CLI / MCP call). Integration handlers pass
   * their own origin so the default `GET /workflows` endpoint can
   * filter to standalone-only by construction.
   */
  readonly origin?: WorkflowOrigin;
  /**
   * Opaque caller-supplied metadata persisted onto the workflow row.
   * Forwarded verbatim to {@link WorkflowEntity.metadata}; defaults
   * to `{}` when omitted.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateWorkflowResult {
  readonly workflowId: string;
  readonly initialCoordNodeId: string;
}

export interface AddNodeOpts {
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly parents: ReadonlyArray<string>;
}

export interface AddNodeResult {
  readonly nodeId: string;
  readonly phase: number;
}

export interface AddEdgeOpts {
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

export interface AddEdgeResult {
  readonly toPhase: number;
}

/**
 * Options accepted by {@link WorkflowService.finishWorkflow}. Discriminated
 * on `outcome`:
 *
 *   - `succeeded` — optional {@link WorkflowSuccess} payload. When
 *     omitted, the substrate persists `{ output: null }` so the row
 *     still satisfies the "succeeded ⇒ success non-null" invariant.
 *   - `failed` — required {@link WorkflowFailure} payload. Coord
 *     MUST supply a human-readable failure to surface in the
 *     dashboard's Overview tab.
 *
 * `cancelled` is NOT an arm here — workflow cancellation is the
 * external-operator route ({@link WorkflowService.cancelWorkflow}),
 * not a coord-driven path.
 */
export type FinishWorkflowOpts =
  | {
      readonly outcome: "succeeded";
      readonly success?: WorkflowSuccess;
    }
  | {
      readonly outcome: "failed";
      readonly failure: WorkflowFailure;
    };

/**
 * Options accepted by {@link WorkflowService.cancelWorkflow}. The
 * `cancellation` payload is REQUIRED — operator MUST supply at
 * least a kind + message. The server route defaults `kind='user'`
 * when omitted on the wire.
 */
export interface CancelWorkflowOpts {
  readonly cancellation: WorkflowCancellation;
}

export interface RemoveEdgeOpts {
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

export interface ReplaceSpecOpts {
  readonly newSpec: unknown;
}

export interface AddSubgraphNodeInput {
  readonly tempId: string;
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly existingParents?: ReadonlyArray<string>;
}

export interface AddSubgraphEdgeInput {
  readonly from: NodeRef;
  readonly to: NodeRef;
}

export interface AddSubgraphOpts {
  readonly nodes: ReadonlyArray<AddSubgraphNodeInput>;
  readonly edges: ReadonlyArray<AddSubgraphEdgeInput>;
}

export interface AddSubgraphInsertedNode {
  readonly tempId: string;
  readonly nodeId: string;
  readonly phase: number;
}

export interface AddSubgraphResult {
  readonly insertedNodes: ReadonlyArray<AddSubgraphInsertedNode>;
}

export interface WorkflowDagSnapshot {
  readonly workflow: WorkflowEntity;
  readonly nodes: readonly WorkflowNodeEntity[];
  readonly edges: readonly WorkflowEdgeEntity[];
}

export interface DispatchAtomicOpts {
  readonly onTerminal?: (result: WorkflowNodeTerminalResult) => void;
}

export interface ListWorkflowOpts {
  readonly coordinatorAgent?: string;
  readonly createdSince?: string;
  readonly idLike?: string;
  /**
   * Filter to workflows whose `origin` matches the given value, or any
   * value in the given array. Accepts a single `WorkflowOrigin` or a
   * readonly array; omit to disable the filter and return workflows of
   * every origin.
   */
  readonly origin?: WorkflowOrigin | readonly WorkflowOrigin[];
}
