import type { WorkflowNodeEntity } from "../node/workflow-node-entity.js";
import { COORDINATOR_KIND, WORKER_KIND } from "../node/workflow-node-kind.js";
import type {
  WorkflowNodeRetryMetadata,
  WorkflowNodeRetryReason,
} from "../node/workflow-node-retry.js";
import { extractWorkflowNodeRetryMetadata } from "../node/workflow-node-retry.js";
import { isTerminalWorkflowNodeStatus } from "../node/workflow-node-status.js";

export type { WorkflowNodeRetryMetadata, WorkflowNodeRetryReason };
export { extractWorkflowNodeRetryMetadata };

export const STUCK_RETRY_MAX_ATTEMPTS = 5;
export const STUCK_RETRY_LIMIT = "STUCK_RETRY_LIMIT";

export type StuckRecoveryOutcome =
  | { readonly inserted: false }
  | {
      readonly inserted: true;
      readonly retryNodeId: string;
      readonly reason: WorkflowNodeRetryReason;
      readonly attempt: number;
    };

export function classifyStuckReason(
  leaves: readonly WorkflowNodeEntity[],
): WorkflowNodeRetryReason | undefined {
  if (leaves.length === 0) return undefined;
  if (!leaves.every((node) => isTerminalWorkflowNodeStatus(node.status))) return undefined;
  if (leaves.length === 1 && leaves[0]?.kind === COORDINATOR_KIND) {
    return "coord_exited_without_action";
  }
  if (leaves.every((node) => node.kind === WORKER_KIND)) {
    return "workers_finished_without_coord";
  }
  return undefined;
}
