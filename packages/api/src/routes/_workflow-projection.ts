/**
 * Wire-shape projection for workflow entities.
 *
 * The substrate stores `WorkflowEntity` (header) and
 * `WorkflowNodeEntity` (per-node) with an opaque `spec: unknown` on
 * the node — only the per-kind `WorkflowNodeRunner` knows the typed
 * shape. The wire DTOs in `@glyphs-ai/api` project that envelope
 * flat for the two shipped kinds (`task` / `coordinator`) and pass
 * unrecognised kinds through verbatim.
 *
 * Lives in the server pkg (not the substrate) because the projection
 * is wire-layer-specific — the substrate stays kind-agnostic and
 * takes no workspace dep on the api wire surface.
 */

import type {
  GetWorkflowNodeResponse,
  GetWorkflowResponse,
  WorkflowDagSnapshot,
  WorkflowEdgeView,
} from "@glyphs-ai/workflow";
import type { ResultAsync } from "neverthrow";
import type {
  WorkflowDag,
  WorkflowEdge,
  WorkflowHeader,
  WorkflowNode,
  WorkflowNodeSpec,
} from "../wire/workflows.js";

/**
 * Narrow dependency surface for the async, taskId-enriched projector.
 * Only the one `findLatestByOrigin` lookup is needed — the full
 * `TaskModule` is intentionally NOT in scope so tests can stub the
 * minimum shape, and the response is structurally typed
 * (`{ id: string } | null`) so the projector doesn't depend on the
 * task package's response type.
 */
interface ProjectionTasksDep {
  readonly findLatestByOrigin: {
    execute(req: {
      readonly origin: string;
      readonly originId: string;
    }): ResultAsync<{ readonly id: string } | null, unknown>;
  };
}

/**
 * Project a workflow view to the wire-shape header. The caller
 * supplies `iterationCount` explicitly — single-workflow routes pass
 * the count computed from a fresh `listNodesByWorkflow` call; list
 * routes pass `undefined` so the field is omitted from the response
 * (computing it per row would be N+1 — see {@link deriveIterationCount}).
 *
 * `awaitingHumanCount` is the number of human-kind nodes currently in
 * `running` status. The caller computes it from the DAG snapshot (show/
 * dag routes) or from a batch query (list route).
 */
export function projectWorkflowHeader(
  wf: GetWorkflowResponse,
  iterationCount: number | undefined,
  awaitingHumanCount: number,
): WorkflowHeader {
  return {
    id: wf.id,
    brief: wf.brief,
    ...(wf.details !== undefined ? { details: wf.details } : {}),
    coordinatorAgent: wf.coordinatorAgent,
    status: wf.status,
    origin: wf.origin,
    ...(wf.originId !== undefined ? { originId: wf.originId } : {}),
    metadata: wf.metadata,
    ...(iterationCount !== undefined ? { iterationCount } : {}),
    awaitingHumanCount,
    createdAt: wf.createdAt,
    ...(wf.startedAt !== undefined ? { startedAt: wf.startedAt } : {}),
    ...(wf.endedAt !== undefined ? { endedAt: wf.endedAt } : {}),
    ...(wf.success !== undefined ? { success: wf.success } : {}),
    ...(wf.failure !== undefined ? { failure: wf.failure } : {}),
    ...(wf.cancellation !== undefined ? { cancellation: wf.cancellation } : {}),
  };
}

/**
 * Count human-kind nodes in `running` status from a list of nodes.
 * Used by show/dag routes that already have the full node list in hand.
 */
export function countAwaitingHuman(nodes: readonly { kind: string; status: string }[]): number {
  return nodes.filter((n) => n.kind === "human" && n.status === "running").length;
}

/**
 * Flatten the node-spec envelope for the two shipped kinds; pass an
 * unrecognised kind through as `{ kind, spec }` so dashboard / CLI code can
 * branch on the discriminator without unwrapping.
 *
 * The cast to the per-kind wire shape is safe because the substrate's
 * per-kind handler validates `spec` shape at insert time (see
 * `workflowWorkerNodeHandler` / `workflowCoordinatorNodeHandler` in
 * `@glyphs-ai/api/wiring`). A schema-corrupted row would surface as a
 * runtime parse error from `WorkflowNodeEntity.fromRow` before
 * reaching this projection.
 */
function projectNodeSpec(node: GetWorkflowNodeResponse): WorkflowNodeSpec {
  if (node.kind === "worker") {
    return { kind: "worker", ...(node.spec as object) } as WorkflowNodeSpec;
  }
  if (node.kind === "coordinator") {
    return { kind: "coordinator", ...(node.spec as object) } as WorkflowNodeSpec;
  }
  if (node.kind === "human") {
    return { kind: "human", ...(node.spec as object) } as WorkflowNodeSpec;
  }
  return { kind: node.kind, spec: node.spec };
}

/**
 * Project a workflow node view to the wire-shape node. Synchronous
 * variant — `taskId` is omitted. Used internally by code paths that
 * don't need the dispatched-task enrichment (e.g. the cancel route
 * which only projects the header).
 *
 * For routes that DO need `taskId` (the `/dag` route), use
 * {@link projectWorkflowNodeWithTaskId}.
 */
function projectWorkflowNodeSync(node: GetWorkflowNodeResponse): WorkflowNode {
  return {
    id: node.id,
    workflowId: node.workflowId,
    phase: node.phase,
    status: node.status,
    spec: projectNodeSpec(node),
    metadata: node.metadata,
    createdAt: node.createdAt,
    ...(node.readyAt !== undefined ? { readyAt: node.readyAt } : {}),
    ...(node.runningAt !== undefined ? { runningAt: node.runningAt } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
  };
}

/**
 * Async variant that enriches the wire-shape node with the
 * dispatched task id pulled from the task service's reverse-lookup
 * (`task.origin === "workflow" && task.originId === node.id`).
 *
 * Both worker AND coordinator kinds get enriched — the substrate
 * dispatches coord agents as tasks via
 * `workflow-coord-task-runner.ts`, which writes the same
 * `(origin = "workflow", origin_id = node.id)` column pair. The
 * dashboard's Mode B drill-down uses `taskId` to navigate to either
 * a worker run or a coord run uniformly.
 *
 * `taskId` is omitted (not `null`, not present) on a node that has
 * no dispatched task yet (a tight window between insert and
 * dispatch in normal operation).
 */
export async function projectWorkflowNodeWithTaskId(
  node: GetWorkflowNodeResponse,
  deps: { readonly tasks: ProjectionTasksDep },
): Promise<WorkflowNode> {
  const sync = projectWorkflowNodeSync(node);
  const found = await deps.tasks.findLatestByOrigin.execute({
    origin: "workflow",
    originId: node.id,
  });
  const task = found.isOk() ? found.value : null;
  if (task === null) return sync;
  return { ...sync, taskId: task.id };
}

/** Project a workflow edge to its wire-shape `(from, to)` pair. */
function projectWorkflowEdge(edge: WorkflowEdgeView): WorkflowEdge {
  return { from: edge.from, to: edge.to };
}

/**
 * Project a full DAG snapshot, enriching each node with its
 * dispatched `taskId` via the task service reverse-lookup. Async
 * because the per-node enrichment is async; node projections are
 * fanned out via `Promise.all` to keep the route response time
 * O(max enrichment) rather than O(sum). `iterationCount` is
 * derived inline from the snapshot's nodes (no extra query — the
 * nodes are already in hand). Mirrors {@link projectWorkflowHeader}
 * for the header field set.
 */
export async function projectWorkflowDag(
  snapshot: WorkflowDagSnapshot,
  deps: { readonly tasks: ProjectionTasksDep },
): Promise<WorkflowDag> {
  const coordCount = snapshot.nodes.filter((n) => n.kind === "coordinator").length;
  const iterationCount = deriveIterationCount(coordCount);
  const awaitingHuman = countAwaitingHuman(snapshot.nodes);
  const nodes = await Promise.all(
    snapshot.nodes.map((n) => projectWorkflowNodeWithTaskId(n, deps)),
  );
  return {
    workflow: projectWorkflowHeader(snapshot.workflow, iterationCount, awaitingHuman),
    nodes,
    edges: snapshot.edges.map(projectWorkflowEdge),
  };
}

/**
 * Compute `iterationCount` for a single workflow by re-fetching its
 * node list. Used by the `GET /:wfid` header route. The dag route
 * uses {@link projectWorkflowDag} which derives it inline.
 */
export function iterationCountForNodes(nodes: readonly GetWorkflowNodeResponse[]): number {
  const coordCount = nodes.filter((n) => n.kind === "coordinator").length;
  return deriveIterationCount(coordCount);
}

/**
 * A workflow's `iterationCount` is its coordinator-node count: each coordinator
 * generation is one planning iteration (a silent-retry coordinator bumps it).
 * Read-projection concern, so it lives in the server rather than the substrate.
 */
function deriveIterationCount(coordNodeCount: number): number {
  return coordNodeCount;
}
