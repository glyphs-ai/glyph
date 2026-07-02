import { z } from "zod";

/** Closed substrate-supported node roles. */
export const WorkflowNodeKindSchema = z.enum(["coordinator", "worker", "human"]);
export type WorkflowNodeKind = z.infer<typeof WorkflowNodeKindSchema>;

/** Runtime list of every supported workflow-node kind. */
export const WORKFLOW_NODE_KINDS = WorkflowNodeKindSchema.options;

export const COORDINATOR_KIND: WorkflowNodeKind = "coordinator";
export const WORKER_KIND: WorkflowNodeKind = "worker";
export const HUMAN_KIND: WorkflowNodeKind = "human";
