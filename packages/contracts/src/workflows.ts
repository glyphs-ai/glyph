/**
 * Wire-shape DTOs for the workflows HTTP / dispatch surface.
 *
 * The workflow substrate (`@glyphs-ai/workflow`) stores nodes as an
 * opaque `{ kind: string, spec: unknown }` envelope and is
 * deliberately kind-agnostic. The per-kind wire DTOs live here, in
 * the cross-cutting `@glyphs-ai/contracts` package, so the substrate
 * stays free of kind knowledge and so the same shapes can be
 * imported by the SPA, the CLI, and the server without dragging in
 * `@glyphs-ai/workflow`'s implementation modules.
 */

import type {
  WorkflowCancellation,
  WorkflowFailure,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowOrigin,
  WorkflowStatus,
  WorkflowSuccess,
} from "@glyphs-ai/workflow";

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

/**
 * Wire-shape spec on workflow node responses. Flat for the two
 * shipped kinds (`worker` / `coordinator`); unrecognized kinds stay
 * in the substrate envelope shape the server projected.
 *
 * The worker / coordinator arms flatten the substrate's
 * `{ kind, spec: { … } }` envelope to `{ kind, …spec }` so dashboard /
 * CLI code can read `node.spec.agent` without unwrapping `spec`.
 */
export type WorkflowNodeSpec =
  | ({ readonly kind: "worker" } & WorkflowWorkerNodeSpec)
  | ({ readonly kind: "coordinator" } & WorkflowCoordinatorNodeSpec)
  | WorkflowHumanNodeSpec
  | { readonly kind: string; readonly spec: unknown };

// ─── HTTP wire-shape DTOs ─────────────────────────────────────────

/**
 * Wire projection of a workflow header. Field set mirrors the
 * persisted `WorkflowEntity` shape verbatim — timestamps are ISO 8601
 * strings (already stored that way), optional `endedAt` is absent on
 * non-terminal rows.
 *
 * `iterationCount` is optional. Per-workflow reads (`GET /:wfid`,
 * `POST /` create response) include it (cheap: the route already has
 * the DAG snapshot in hand). The list endpoint (`GET /`) omits it
 * because computing it would require an N+1 fan-out across every
 * row in the result set to load each workflow's DAG. Treat the field
 * as a per-workflow diagnostic, not a list-row invariant.
 *
 * `success` / `failure` / `cancellation` are terminal payloads —
 * exactly the one matching `status` is present on terminal rows.
 */
export interface WorkflowHeader {
  readonly id: string;
  readonly brief: string;
  readonly details?: string;
  readonly coordinatorAgent: string;
  readonly status: WorkflowStatus;
  readonly origin: WorkflowOrigin;
  readonly metadata: Readonly<Record<string, unknown>>;
  /**
   * Coordinator-chain depth at projection time. Present on
   * per-workflow reads; omitted on list rows to avoid an N+1
   * snapshot fan-out across the result set.
   */
  readonly iterationCount?: number;
  /**
   * Count of human-kind nodes currently in `running` status (i.e.
   * awaiting human input). Always emitted; 0 when no human nodes
   * are waiting.
   */
  readonly awaitingHumanCount: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly success?: WorkflowSuccess;
  readonly failure?: WorkflowFailure;
  readonly cancellation?: WorkflowCancellation;
}

/**
 * Wire projection of a single workflow node. Per-kind `spec` is
 * projected flat via {@link WorkflowNodeSpec}. Lifecycle
 * timestamps mirror the persisted `WorkflowNodeEntity` shape —
 * `readyAt` / `runningAt` / `endedAt` are present once the node has
 * reached that state.
 */
export interface WorkflowNode {
  readonly id: string;
  readonly workflowId: string;
  readonly phase: number;
  readonly status: WorkflowNodeStatus;
  /**
   * Dispatched task id for this node. Present iff this node has a
   * dispatched task — both worker AND coordinator nodes get a
   * `taskId` because the substrate dispatches coord agents as tasks
   * too (see `packages/api/src/wiring/workflow-coord-task-runner.ts`).
   * Absent on a node that has been inserted but not yet dispatched
   * (a tight window in normal operation). Server-enriched at
   * projection time via the `task.metadata.workflowNodeId === node.id`
   * reverse-lookup; see `projectWorkflowNodeWithTaskId` in
   * `packages/server/src/routes/_workflow-projection.ts`.
   */
  readonly taskId?: string;
  readonly spec: WorkflowNodeSpec;
  /**
   * Free-form per-node metadata (always an object — defaults to
   * `{}` if no entries). The substrate currently writes one
   * key: `retry` with shape `{ of: string; reason: string;
   * attempt: number }` when a node is a retry-coord inserted by
   * the stuck-workflow detector. All other keys are opaque to
   * consumers.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly readyAt?: string;
  readonly runningAt?: string;
  readonly endedAt?: string;
}

/** Wire projection of one DAG edge — parent / child node ids only. */
export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * Wire projection of the full DAG snapshot returned by
 * `GET /workspaces/:id/workflows/:wfid/dag`. The header is denormed
 * onto the snapshot for client convenience (so a single fetch yields
 * everything the dashboard needs to render the graph).
 */
export interface WorkflowDag {
  readonly workflow: WorkflowHeader;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
}

/**
 * Request body for `POST /workspaces/:id/workflows`. Mirrors
 * `WorkflowService.createWorkflow` args.
 */
export interface CreateWorkflowRequest {
  readonly brief: string;
  readonly details?: string;
  readonly coordinatorAgent: string;
}

/**
 * Query string for `GET /workspaces/:id/workflows`. All three slots
 * are optional; absent slots widen the result set. The server
 * forwards the trio to `WorkflowService.list` as-is.
 *
 *   - `q`                — case-sensitive substring match on the
 *     workflow id (escapes SQL `LIKE` metacharacters).
 *   - `coordinatorAgent` — exact match on the workflow's denormalised
 *     `coordinator_agent` column.
 *   - `createdSince`     — ISO 8601 lower bound (inclusive) on
 *     `created_at`. Mirrors the `?range=` time-preset semantics on
 *     the Tasks page once the dashboard converts a preset to an ISO
 *     cutoff.
 *
 * There is intentionally no `status` filter on the wire; clients
 * group workflows into Running/Completed sections after fetching.
 */
export interface WorkflowListQuery {
  readonly q?: string;
  readonly coordinatorAgent?: string;
  readonly createdSince?: string;
}

// ─── Mutation primitives — wire-shape DTOs ────────────────────────
//
// One body shape per substrate mutation primitive. Each mirrors the
// corresponding `WorkflowService.<method>(args)` shape 1:1, with one
// boundary translation: `workflowId` lives in the URL path, not the
// body. Wire shapes are JSON-safe — plain literal-union strings (no
// `Date`, `Map`, `Set`, `Symbol`).
//
// The substrate does not derive any caller identity from mutation
// bodies; the only lifecycle gate is the workflow's own status, which
// is re-checked atomically inside each write tx. A request against a
// terminal workflow surfaces `WorkflowAlreadyTerminalError` → 409.

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/nodes`.
 * Mirrors `WorkflowService.addNode` args minus `workflowId` (in path).
 *
 * `spec` is forwarded verbatim to the substrate — the per-kind runner
 * is the validator. `parents` MUST have ≥1 entry; an empty array is
 * rejected by the substrate with `EmptyParentsError` → 400.
 */
export interface AddNodeRequest {
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly parents: readonly string[];
}

/**
 * Response of `POST /workspaces/:id/workflows/:wfid/nodes`. Mirrors
 * `AddNodeResult` from the substrate.
 */
export interface AddNodeResponse {
  readonly nodeId: string;
  readonly phase: number;
}

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/edges`.
 * Mirrors `WorkflowService.addEdge` args minus `workflowId`.
 */
export interface AddEdgeRequest {
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

/**
 * Response of `POST /workspaces/:id/workflows/:wfid/edges`. Echoes the
 * pair back so the caller has a self-contained record of the inserted
 * edge without re-fetching the DAG, plus the substrate's recomputed
 * `toPhase` (the receiving node's phase may have shifted when the new
 * edge was inserted, so the caller needs the post-insert value to
 * stay in sync without a follow-up `getDag` call).
 */
export interface AddEdgeResponse {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly toPhase: number;
}

/**
 * Wire-shape projection of the substrate's `NodeRef` discriminated
 * union. Structural-discriminator union — exactly one of `nodeId`
 * (resolve to an existing node) or `tempId` (resolve to a temp node
 * declared in the same `addSubgraph` batch). The server route
 * boundary tags this with `kind` and renames `nodeId`→`id` before
 * calling the substrate, so the wire stays JSON-friendly (no extra
 * discriminator field) while the substrate stays type-friendly.
 */
export type WorkflowNodeRef = { readonly nodeId: string } | { readonly tempId: string };

/**
 * One declared temp node in an `addSubgraph` batch. Mirrors
 * `AddSubgraphNodeInput` from the substrate. `existingParents` is
 * optional and defaults to `[]` (the substrate normalizes); intra-
 * batch parent edges go in {@link AddSubgraphRequest.edges}.
 */
export interface AddSubgraphRequestNode {
  readonly tempId: string;
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly existingParents?: readonly string[];
}

/** One declared edge in an `addSubgraph` batch. */
export interface AddSubgraphRequestEdge {
  readonly from: WorkflowNodeRef;
  readonly to: WorkflowNodeRef;
}

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/subgraph`.
 * Mirrors `WorkflowService.addSubgraph` args minus `workflowId`.
 *
 * `nodes.length ≥ 1` is required; the substrate rejects an empty
 * batch with `WorkflowSubgraphEmptyError` → 400.
 */
export interface AddSubgraphRequest {
  readonly nodes: readonly AddSubgraphRequestNode[];
  readonly edges: readonly AddSubgraphRequestEdge[];
}

/**
 * Per-inserted-node entry on `AddSubgraphResponse`. Echoes the
 * caller-supplied `tempId` alongside the substrate-allocated `nodeId`
 * + computed `phase` so the caller can map results back to its batch.
 */
export interface AddSubgraphResponseInsertedNode {
  readonly tempId: string;
  readonly nodeId: string;
  readonly phase: number;
}

/** Response of `POST /workspaces/:id/workflows/:wfid/subgraph`. */
export interface AddSubgraphResponse {
  readonly insertedNodes: readonly AddSubgraphResponseInsertedNode[];
}

/**
 * Request body for `PATCH /workspaces/:id/workflows/:wfid/nodes/:nid/spec`.
 * `newSpec` is forwarded verbatim — the per-kind runner re-validates
 * with the same rules used at insert time.
 */
export interface ReplaceNodeSpecRequest {
  readonly newSpec: unknown;
}

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/finish`.
 * Discriminated on `kind`:
 *
 *   - `succeeded` — `success` is optional. When omitted, the server
 *     defaults the persisted payload to `{ output: null }`.
 *   - `failed`    — `failure` is REQUIRED. `message` is a free-form
 *     string (empty allowed).
 *
 * Workflow-level cancellation is a separate route
 * (`POST .../cancel`) — see {@link CancelWorkflowRequest}.
 */
export type FinishWorkflowRequest =
  | {
      readonly kind: "succeeded";
      readonly success?: { readonly output?: string | null };
    }
  | {
      readonly kind: "failed";
      readonly failure: { readonly kind: "coordinator"; readonly message: string };
    };

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/cancel`.
 * `cancellation.kind` identifies the cancellation source; `message`
 * is a free-form string (empty allowed).
 */
export interface CancelWorkflowRequest {
  readonly cancellation: {
    readonly kind: "user";
    readonly message: string;
  };
}

/**
 * MIME bucket for a workflow artifact. Hint used by the dashboard's
 * Artifacts tab to pick an icon (📄 text / 🖼️ image / 📦 archive /
 * 📎 generic) without doing its own ext sniffing. Server-side
 * detection lives in `packages/server/src/util/mime-bucket.ts`.
 */
export type WorkflowArtifactMimeBucket = "text" | "image" | "archive" | "generic";

/**
 * Wire projection of a single workflow artifact. Discriminated by
 * `kind`:
 *
 *   - `workflow-summary` — file under `<workflowDir>/artifact/`,
 *     curated by the coordinator. `path` is relative to that root.
 *     Coordinator may rewrite at any time (the static-bytes route
 *     sends `Cache-Control: no-store` for this kind).
 *   - `node` — file under `<tasks-root>/<taskId>/artifact/`, owned
 *     by a single worker / coord node. Write-once after the task
 *     terminates (the static-bytes route sends `Cache-Control:
 *     max-age=300` for this kind).
 *
 * `mimeBucket` is the server's presentation hint — see
 * {@link WorkflowArtifactMimeBucket}.
 */
export type WorkflowArtifact =
  | {
      readonly kind: "workflow-summary";
      /** Relative path under `<workflowDir>/artifact/`. */
      readonly path: string;
      /** Size in bytes. */
      readonly size: number;
      /** RFC3339 mtime. */
      readonly modifiedAt: string;
      /** Detected MIME bucket: "text" | "image" | "archive" | "generic". */
      readonly mimeBucket: WorkflowArtifactMimeBucket;
    }
  | {
      readonly kind: "node";
      /** The owning node id. */
      readonly nodeId: string;
      /** The owning node's task id (from substrate enrichment). */
      readonly taskId: string;
      /** Relative path under `<tasks-root>/<taskId>/artifact/`. */
      readonly path: string;
      readonly size: number;
      readonly modifiedAt: string;
      readonly mimeBucket: WorkflowArtifactMimeBucket;
    };

/**
 * Wire response shape for `GET /workspaces/:id/workflows/:wfid/artifacts`.
 *
 * Artifacts are listed in two namespaces: `workflow-summary`
 * artifacts live under `<workflowDir>/artifact/` (curated by the
 * coordinator); `node` artifacts live under each worker / coord
 * task's `artifact/` dir. The list route aggregates both,
 * `workflow-summary` first then `node` groups sorted by `nodeId` for
 * stability.
 */
export interface WorkflowArtifactsResponse {
  readonly artifacts: readonly WorkflowArtifact[];
}

// ─── Human node wire types ────────────────────────────────────────

/**
 * Wire-shape spec for a human-kind workflow node. Flat projection
 * matching the substrate's `HumanNodeSpec`.
 *
 * `promptStyle` tells the dashboard renderer how to interpret
 * `prompt`: `"plain"` for literal text, `"markdown"` for the
 * dashboard's in-house block / inline markdown renderer.
 */
export interface WorkflowHumanNodeSpec {
  readonly kind: "human";
  readonly prompt: string;
  readonly promptStyle: "plain" | "markdown";
  readonly choices?: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Request body for `POST /workspaces/:id/workflows/:wfid/nodes/:nid/respond`.
 * Responds to a human-kind node that is in `running` status.
 *
 *   - `choiceId` — the selected choice id (must match one of
 *     `spec.choices[].id`). When absent, the response is freeform.
 *   - `input` — freeform text; required when `choiceId` is absent,
 *     optional otherwise.
 */
export interface RespondHumanNodeRequest {
  readonly choiceId?: string;
  readonly input?: string;
}
