import { err, ok, type Result } from "neverthrow";
import type {
  CoordSpecNotEditable,
  NodeKindMismatch,
  WorkflowNodeNotFound,
  WorkflowNodeNotMutable,
} from "../workflow/workflow-entity-errors.js";
import { workflowNodeNotMutable } from "../workflow/workflow-entity-errors.js";
import type { WorkflowNodeEntity } from "./workflow-node-entity.js";
import type { WorkflowNodeId } from "./workflow-node-id.js";
import { COORDINATOR_KIND, type WorkflowNodeKind } from "./workflow-node-kind.js";

/**
 * The ordered failure set for a spec-patch guard. The order matters: callers
 * surface the first violation, so the layering (not-found → coord → kind →
 * not-mutable) is the contract, not an implementation detail.
 */
export type NodeSpecUpdateGuardError =
  | WorkflowNodeNotFound
  | CoordSpecNotEditable
  | NodeKindMismatch
  | WorkflowNodeNotMutable;

/**
 * Shared precondition guard for a partial spec patch, used both by the
 * aggregate's authoritative `updateNodeSpec` mutation and by the use case's
 * pre-validate check (so the runner is chosen for the right kind and a
 * coordinator / mismatched target rejects before any IO-bound `validate`).
 *
 * Guard order (first failure wins):
 *   1. node exists in this workflow → else {@link WorkflowNodeNotFound}
 *   2. node is not a coordinator    → else {@link CoordSpecNotEditable}
 *   3. node kind matches the body   → else {@link NodeKindMismatch}
 *   4. node is still `not_started`   → else {@link WorkflowNodeNotMutable}
 *
 * Coordinator rejection sits ahead of the kind check on purpose: a coordinator
 * target is never patchable, whatever kind the body claims, so it must resolve
 * to `CoordSpecNotEditable` rather than a confusing kind mismatch.
 */
export function assertNodeSpecUpdatable(args: {
  readonly workflowId: string;
  readonly nodeId: WorkflowNodeId;
  readonly node: WorkflowNodeEntity | undefined;
  readonly expectedKind: WorkflowNodeKind;
}): Result<WorkflowNodeEntity, NodeSpecUpdateGuardError> {
  const { workflowId, nodeId, node, expectedKind } = args;
  if (node === undefined || node.workflowId !== workflowId)
    return err({ type: "WorkflowNodeNotFound", workflowId, nodeId });
  if (node.kind === COORDINATOR_KIND)
    return err({ type: "CoordSpecNotEditable", workflowId, nodeId });
  if (node.kind !== expectedKind)
    return err({
      type: "NodeKindMismatch",
      workflowId,
      nodeId,
      expected: expectedKind,
      actual: node.kind,
    });
  if (node.status !== "not_started")
    return err(workflowNodeNotMutable(workflowId, nodeId, node.status, "updateNodeSpec"));
  return ok(node);
}
