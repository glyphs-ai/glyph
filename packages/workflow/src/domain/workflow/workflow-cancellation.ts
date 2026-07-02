import { z } from "zod";

/** Payload attached when an operator cancels a workflow. */
export const WorkflowCancellationSchema = z.object({
  kind: z.literal("user"),
  message: z.string(),
});
export type WorkflowCancellation = z.infer<typeof WorkflowCancellationSchema>;
