import { z } from "zod";

/** Workflow-level lifecycle. `running` is the only non-terminal status. */
export const WorkflowStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
