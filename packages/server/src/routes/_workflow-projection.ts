/**
 * Wire-shape projection for workflow entities.
 *
 * The substrate stores `WorkflowEntity` (header) and
 * `WorkflowNodeEntity` (per-node) with an opaque `spec: unknown` on
 * the node — only the per-kind `WorkflowNodeRunner` knows the typed
 * shape. The wire DTOs in `@glyphs-ai/contracts` project that envelope
 * flat for the two shipped kinds (`task` / `coordinator`) and pass
 * unrecognised kinds through verbatim.
 *
 * Lives in the server pkg (not the substrate) because the projection
 * is wire-layer-specific — the substrate stays kind-agnostic and
 * takes no workspace dep on `@glyphs-ai/contracts`.
 */

import type {
  WorkflowDagWire,
  WorkflowEdgeWire,
  WorkflowHeaderWire,
  WorkflowNodeWire,
  WorkflowNodeWireSpec,
} from "@glyphs-ai/api";
import {
  deriveIterationCount,
  type WorkflowDagSnapshot,
  type WorkflowEdgeEntity,
  type WorkflowEntity,
  type WorkflowNodeEntity,
} from "@glyphs-ai/workflow";

/**
 * Narrow dependency surface for the async, taskId-enriched projector.
 * Only the one `findTaskByWorkflowNode` lookup is needed — the full
 * `TaskService` is intentionally NOT in scope so tests can stub the
 * minimum shape, and the return type is structurally typed
 * (`{ id: string } | null`) so the projector doesn't depend on the
 * internal `TaskEntity` class.
 */
interface ProjectionTasksDep {
  findTaskByWorkflowNode(nodeId: string): Promise<{ readonly id: string } | null>;
}

/**
 * Project a `WorkflowEntity` to the wire-shape header. The caller
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
  wf: WorkflowEntity,
  iterationCount: number | undefined,
  awaitingHumanCount: number,
): WorkflowHeaderWire {
  return {
    id: wf.id,
    brief: wf.brief,
    ...(wf.details !== undefined ? { details: wf.details } : {}),
    coordinatorAgent: wf.coordinatorAgent,
    status: wf.status,
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
function projectNodeSpec(node: WorkflowNodeEntity): WorkflowNodeWireSpec {
  if (node.kind === "worker") {
    return { kind: "worker", ...(node.spec as object) } as WorkflowNodeWireSpec;
  }
  if (node.kind === "coordinator") {
    return { kind: "coordinator", ...(node.spec as object) } as WorkflowNodeWireSpec;
  }
  if (node.kind === "human") {
    return { kind: "human", ...(node.spec as object) } as WorkflowNodeWireSpec;
  }
  return { kind: node.kind, spec: node.spec };
}

/**
 * Project a `WorkflowNodeEntity` to the wire-shape node. Synchronous
 * variant — `taskId` is omitted. Used internally by code paths that
 * don't need the dispatched-task enrichment (e.g. the cancel route
 * which only projects the header).
 *
 * For routes that DO need `taskId` (the `/dag` route), use
 * {@link projectWorkflowNodeWithTaskId}.
 */
function projectWorkflowNodeSync(node: WorkflowNodeEntity): WorkflowNodeWire {
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
 * (`task.metadata.workflowNodeId === node.id`).
 *
 * Both worker AND coordinator kinds get enriched — the substrate
 * dispatches coord agents as tasks via
 * `workflow-coord-task-runner.ts`, which writes the same
 * `metadata.workflowNodeId` key. The dashboard's Mode B drill-down
 * uses `taskId` to navigate to either a worker run or a coord run
 * uniformly.
 *
 * `taskId` is omitted (not `null`, not present) on a node that has
 * no dispatched task yet (a tight window between insert and
 * dispatch in normal operation).
 */
export async function projectWorkflowNodeWithTaskId(
  node: WorkflowNodeEntity,
  deps: { readonly tasks: ProjectionTasksDep },
): Promise<WorkflowNodeWire> {
  const sync = projectWorkflowNodeSync(node);
  const task = await deps.tasks.findTaskByWorkflowNode(node.id);
  if (task === null) return sync;
  return { ...sync, taskId: task.id };
}

/** Project a `WorkflowEdgeEntity` to its wire-shape `(from, to)` pair. */
function projectWorkflowEdge(edge: WorkflowEdgeEntity): WorkflowEdgeWire {
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
): Promise<WorkflowDagWire> {
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
export function iterationCountForNodes(nodes: readonly WorkflowNodeEntity[]): number {
  const coordCount = nodes.filter((n) => n.kind === "coordinator").length;
  return deriveIterationCount(coordCount);
}
