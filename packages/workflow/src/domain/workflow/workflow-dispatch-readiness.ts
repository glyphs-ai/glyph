import type { WorkflowNodeEntity } from "../node/workflow-node-entity.js";
import {
  COORDINATOR_KIND,
  HUMAN_KIND,
  WORKER_KIND,
  type WorkflowNodeKind,
} from "../node/workflow-node-kind.js";
import { isTerminalWorkflowNodeStatus } from "../node/workflow-node-status.js";

export function parentsReadyForKind(
  kind: WorkflowNodeKind,
  parents: readonly WorkflowNodeEntity[],
): boolean {
  if (parents.length === 0) return true;
  switch (kind) {
    case WORKER_KIND:
    case HUMAN_KIND:
      return parents.every((parent) => parent.status === "succeeded");
    case COORDINATOR_KIND:
      return parents.every((parent) => isTerminalWorkflowNodeStatus(parent.status));
    default:
      return false;
  }
}
