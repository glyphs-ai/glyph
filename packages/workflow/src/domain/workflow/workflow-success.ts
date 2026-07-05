import { z } from "zod";

/** Payload attached when a workflow transitions to `succeeded`. */
export const WorkflowSuccessSchema = z.object({
  output: z.string().nullable(),
});
export type WorkflowSuccess = z.infer<typeof WorkflowSuccessSchema>;
