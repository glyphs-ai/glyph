import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Canonical workflow-node id: UUIDv4, matching `crypto.randomUUID()` output.
 * Node ids live inside a workflow, so they do not carry a date prefix.
 */
export const WorkflowNodeIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "must be a UUIDv4",
  )
  .brand("WorkflowNodeId");

export type WorkflowNodeId = z.infer<typeof WorkflowNodeIdSchema>;

/** The caller-supplied value did not match the canonical workflow-node-id format. */
export type InvalidWorkflowNodeId = {
  readonly type: "InvalidWorkflowNodeId";
  readonly id: unknown;
};

/** UUIDv4 generator for new workflow nodes. */
export function generateWorkflowNodeId(randomUUIDFn: () => string = randomUUID): WorkflowNodeId {
  return WorkflowNodeIdSchema.parse(randomUUIDFn());
}
