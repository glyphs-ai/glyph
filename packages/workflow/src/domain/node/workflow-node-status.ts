import { z } from "zod";

/** Per-node lifecycle shared by coordinator, worker, and human nodes. */
export const WorkflowNodeStatusSchema = z.enum([
  "not_started",
  "ready",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type WorkflowNodeStatus = z.infer<typeof WorkflowNodeStatusSchema>;

/** A node status from which the unit of work has reached a final outcome. */
export type TerminalWorkflowNodeStatus = Extract<
  WorkflowNodeStatus,
  "succeeded" | "failed" | "cancelled"
>;

/** Runtime list of terminal node statuses, kept in lock-step with the type. */
export const TERMINAL_WORKFLOW_NODE_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly TerminalWorkflowNodeStatus[];

const TERMINAL_WORKFLOW_NODE_STATUS_SET: ReadonlySet<WorkflowNodeStatus> = new Set(
  TERMINAL_WORKFLOW_NODE_STATUSES,
);

/** Whether a node status is terminal (its unit of work has reached a final outcome). */
export function isTerminalWorkflowNodeStatus(status: WorkflowNodeStatus): boolean {
  return TERMINAL_WORKFLOW_NODE_STATUS_SET.has(status);
}
