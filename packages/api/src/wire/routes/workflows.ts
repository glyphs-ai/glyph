/**
 * Workflow routes (workspace-scoped) plus the workflow path-param wire
 * shapes. Covers the schedule-origin list, the read surface (list / get
 * / dag / node / artifacts), the external cancel, and the full
 * coord-callback mutation surface. The wire DTOs themselves live in
 * `../workflows.js`; this module only declares path params and the
 * manifest slice.
 */

import type {
  AddEdgeRequest,
  AddEdgeResponse,
  AddNodeRequest,
  AddNodeResponse,
  AddSubgraphRequest,
  AddSubgraphResponse,
  CancelWorkflowRequest,
  CreateWorkflowRequest,
  FinishWorkflowRequest,
  ReplaceNodeSpecRequest,
  RespondHumanNodeRequest,
  WorkflowArtifactsResponse,
  WorkflowDag,
  WorkflowHeader,
  WorkflowListQuery,
  WorkflowNode,
} from "../workflows.js";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";
import type { WorkspacePathParams } from "./workspaces.js";

/** DELETE /api/workspaces/:id/workflows/:wfid query params. */
export interface WorkflowDeleteQuery {
  readonly purge?: "1";
}

/** Workflow-scoped path params (header / dag / cancel). */
export interface WorkflowPathParams {
  readonly id: string;
  readonly wfid: string;
}

/**
 * Workflow-node-scoped path params (cancel-node / remove-node /
 * replace-spec). Extends {@link WorkflowPathParams} with the node id
 * segment.
 */
export interface WorkflowNodePathParams extends WorkflowPathParams {
  readonly nid: string;
}

/**
 * Workflow-edge-scoped path params (remove-edge). Extends
 * {@link WorkflowPathParams} with the (from, to) endpoint pair that
 * uniquely identifies a live edge in the workflow's DAG.
 */
export interface WorkflowEdgePathParams extends WorkflowPathParams {
  readonly from: string;
  readonly to: string;
}

/**
 * Path params for the single-artifact static-bytes route. The
 * `encodedPath` segment carries a `summary/<rest>` or
 * `nodes/<nodeId>/<rest>` sentinel with `/` percent-encoded as
 * `%2F` so it fits one Hono path segment.
 */
export interface WorkflowArtifactPathParams {
  readonly id: string;
  readonly wfid: string;
  readonly encodedPath: string;
}

export const workflowRoutes = {
  /**
   * Schedule-origin list of workflows launched by cron triggers.
   * Mirrors `tasks.scheduled.list` but returns `WorkflowHeader[]`.
   * Constrained to schedule-launched workflows (`origin = "schedule"`)
   * server-side; callers cannot widen.
   */
  "workflows.scheduled.list": defineRoute<
    { params: WorkspacePathParams; query: { readonly scheduleId?: string } },
    readonly WorkflowHeader[]
  >("GET", "/api/workspaces/:id/scheduled-workflows"),
  /**
   * List workflows in this workspace, newest-first by `created_at`.
   * Supports the query slots declared by {@link WorkflowListQuery}:
   * `q`, `coordinatorAgent`, and `createdSince`. There is no `status`
   * filter; clients group running and completed workflows after
   * fetching.
   *
   * `iterationCount` is omitted from list response items: computing
   * the true value would require an N+1 fan-out (one DAG snapshot
   * per row) across the entire result set, so the list endpoint
   * stays O(workflows). Callers that need an accurate count fetch
   * the workflow header (`workflows.get`), which includes
   * `iterationCount` derived from a single per-workflow node list.
   */
  "workflows.list": defineRoute<
    { params: WorkspacePathParams; query: WorkflowListQuery },
    readonly WorkflowHeader[]
  >("GET", "/api/workspaces/:id/workflows"),
  /**
   * Seed a new workflow + its initial coordinator node. Body mirrors
   * `WorkflowService.createWorkflow` args.
   */
  "workflows.create": defineRoute<
    { params: WorkspacePathParams; body: CreateWorkflowRequest },
    WorkflowHeader
  >("POST", "/api/workspaces/:id/workflows"),
  /**
   * Workflow header lookup. `iterationCount` is computed exactly
   * from a single per-workflow node-list query (counts coord-kind
   * nodes; silent-retry coords count too).
   */
  "workflows.get": defineRoute<{ params: WorkflowPathParams }, WorkflowHeader>(
    "GET",
    "/api/workspaces/:id/workflows/:wfid",
  ),
  /** Full DAG snapshot (header + nodes + edges) in a single fetch. */
  "workflows.dag.get": defineRoute<{ params: WorkflowPathParams }, WorkflowDag>(
    "GET",
    "/api/workspaces/:id/workflows/:wfid/dag",
  ),
  /**
   * Single workflow node lookup. Returns the projected node wire
   * shape — same shape as the entries inside `workflows.dag.get`
   * response `nodes`,
   * but addressable without paying for the full DAG snapshot. 404
   * when either the workflow or the node id does not resolve.
   */
  "workflows.nodes.get": defineRoute<{ params: WorkflowNodePathParams }, WorkflowNode>(
    "GET",
    "/api/workspaces/:id/workflows/:wfid/nodes/:nid",
  ),
  /**
   * External cancel — flips the workflow to `cancelled` and
   * reconciles every non-terminal node. The body requires
   * `cancellation: { kind: 'user', message }` so the operator's
   * reason is persisted into the workflow's `cancellation` column.
   * Returns the updated workflow header so callers see the
   * post-cancel `endedAt` / `status` without a second round-trip.
   */
  "workflows.cancel": defineRoute<
    { params: WorkflowPathParams; body: CancelWorkflowRequest },
    WorkflowHeader
  >("POST", "/api/workspaces/:id/workflows/:wfid/cancel"),
  /**
   * List artifacts for a workflow: workflow-summary entries (curated
   * by the coordinator under `<workflowDir>/artifact/`) followed by
   * per-node entries (one group per dispatched task). Returns
   * `{ artifacts: [] }` (200) when neither namespace has anything
   * curated yet; 404 when the workflow id is unknown.
   */
  "workflows.artifacts.list": defineRoute<
    { params: WorkflowPathParams },
    WorkflowArtifactsResponse
  >("GET", "/api/workspaces/:id/workflows/:wfid/artifacts"),
  /**
   * Static-bytes for one artifact. `encodedPath` is a single Hono
   * path segment so multi-segment paths MUST percent-encode `/` as
   * `%2F`. Two sentinels:
   *   - `summary/<rest>` — workflow-summary artifact (`no-store`)
   *   - `nodes/<nodeId>/<rest>` — per-node artifact (`max-age=300`)
   * 400 on unknown prefix or traversal attempt; 404 on missing file.
   */
  "workflows.artifacts.get": defineRoute<{ params: WorkflowArtifactPathParams }, never>(
    "GET",
    "/api/workspaces/:id/workflows/:wfid/artifacts/:encodedPath",
  ),

  // ── workflow mutation surface (coord-callback routes) ─────────────
  //
  // Eight routes that expose the substrate's full mutation surface
  // (every primitive on `WorkflowService` except `cancelWorkflow`, which
  // is the external-operator route above). Order here is alphabetical
  // for diff legibility; the server's mount order is governed by Hono's
  // route matching (more-specific paths win).
  "workflows.edges.add": defineRoute<
    { params: WorkflowPathParams; body: AddEdgeRequest },
    AddEdgeResponse
  >("POST", "/api/workspaces/:id/workflows/:wfid/edges"),
  "workflows.nodes.add": defineRoute<
    { params: WorkflowPathParams; body: AddNodeRequest },
    AddNodeResponse
  >("POST", "/api/workspaces/:id/workflows/:wfid/nodes"),
  "workflows.subgraph.add": defineRoute<
    { params: WorkflowPathParams; body: AddSubgraphRequest },
    AddSubgraphResponse
  >("POST", "/api/workspaces/:id/workflows/:wfid/subgraph"),
  /**
   * Cancel a single worker-kind node. Coord-kind cancellation is
   * deferred — cancel the workflow instead via the external
   * `workflows.cancel` route. The substrate rejects coord-kind targets
   * with `WorkflowNodeNotMutableError` → 409.
   */
  "workflows.nodes.cancel": defineRoute<{ params: WorkflowNodePathParams }, WorkflowNode>(
    "POST",
    "/api/workspaces/:id/workflows/:wfid/nodes/:nid/cancel",
  ),
  /**
   * Respond to a human-kind node that is waiting for input. The node
   * must be `kind === "human"` and `status === "running"`. On success,
   * the response is written into `node.metadata.response` and the node
   * transitions to `succeeded`, waking downstream nodes.
   */
  "workflows.nodes.respond": defineRoute<
    { params: WorkflowNodePathParams; body: RespondHumanNodeRequest },
    WorkflowNode
  >("POST", "/api/workspaces/:id/workflows/:wfid/nodes/:nid/respond"),
  /**
   * Last act of a coord task: flip the workflow terminal. `kind`
   * MUST be `succeeded` or `failed`. Substrate enforces "no other
   * running nodes" (the caller coord is excluded); a running worker
   * surfaces `WorkflowAlreadyTerminalError` on the race.
   */
  "workflows.finish": defineRoute<
    { params: WorkflowPathParams; body: FinishWorkflowRequest },
    WorkflowHeader
  >("POST", "/api/workspaces/:id/workflows/:wfid/finish"),
  /**
   * Delete a workflow. Two modes via the `?purge=1` query flag, mirroring
   * `tasks.delete`:
   *
   *   - default (no `?purge`): **archive** — drops the workflow row +
   *     every owned node + every owned edge from the substrate DB and
   *     cascades `tasks.delete(taskId)` (archive mode) for each node's
   *     owning task. The on-disk shared workflow dir and per-node task
   *     workdirs are preserved so the operator can still inspect the
   *     run after the fact.
   *
   *   - `?purge=1` — **hard delete** — archive + remove the shared
   *     workflow dir + cascade `tasks.delete(taskId, { purge: 1 })` for
   *     each node's owning task (per-task workdir + runtime state).
   *
   * Lifecycle gate: the workflow must be terminal. A running workflow
   * yields 409 `WorkflowDeleteRequiresTerminalError` with envelope
   * `{ code, status, transition: 'delete' }` (parallel to
   * `tasks.delete`'s `InvalidTransition` envelope). A workflow whose
   * own row is terminal but which still has an in-flight node task
   * (e.g. the coordinator task draining its final tick after
   * `finishWorkflow`) yields 409 `WorkflowDeleteHasInFlightTasks` with
   * an envelope carrying the offending node ids — the operator should
   * cancel the workflow first or wait briefly and retry.
   */
  "workflows.delete": defineRoute<{ params: WorkflowPathParams; query: WorkflowDeleteQuery }, void>(
    "DELETE",
    "/api/workspaces/:id/workflows/:wfid",
  ),
  /**
   * Delete a single edge `(from, to)`. Endpoints live in the path,
   * not the body, so the route is RESTful: `DELETE` on the edge's
   * canonical address. The to-node must be `not_started` and would
   * retain ≥1 parent after the delete.
   */
  "workflows.edges.remove": defineRoute<{ params: WorkflowEdgePathParams }, void>(
    "DELETE",
    "/api/workspaces/:id/workflows/:wfid/edges/:from/:to",
  ),
  /**
   * Delete a single node. Status must be `not_started` (sealing
   * rule); no orphaned children remain. All adjacent edges are
   * deleted in the same tx.
   */
  "workflows.nodes.remove": defineRoute<{ params: WorkflowNodePathParams }, void>(
    "DELETE",
    "/api/workspaces/:id/workflows/:wfid/nodes/:nid",
  ),
  /**
   * Re-validate + replace a node's opaque `spec` payload. Kind cannot
   * change (no `newKind` arg). The per-kind runner's `validate` runs
   * with the new spec; rejections bubble out as `WorkflowNodeSpecError`
   * / kind-specific subclasses.
   */
  "workflows.nodes.spec.replace": defineRoute<
    { params: WorkflowNodePathParams; body: ReplaceNodeSpecRequest },
    WorkflowNode
  >("PATCH", "/api/workspaces/:id/workflows/:wfid/nodes/:nid/spec"),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
