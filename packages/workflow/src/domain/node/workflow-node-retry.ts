import { z } from "zod";

/** Closed reasons the substrate inserts an automatic retry coordinator. */
export const WorkflowNodeRetryReasonSchema = z.enum([
  "coord_exited_without_action",
  "workers_finished_without_coord",
]);
export type WorkflowNodeRetryReason = z.infer<typeof WorkflowNodeRetryReasonSchema>;

/** Shape persisted on `node.metadata.retry` for retry coordinator provenance. */
export const WorkflowNodeRetryMetadataSchema = z.object({
  of: z.string().min(1),
  reason: WorkflowNodeRetryReasonSchema,
  attempt: z.number().int().min(1),
});
export type WorkflowNodeRetryMetadata = z.infer<typeof WorkflowNodeRetryMetadataSchema>;

/** Read a well-formed retry block; malformed or partial blocks are treated as absent. */
export function extractWorkflowNodeRetryMetadata(
  meta: Readonly<Record<string, unknown>>,
): WorkflowNodeRetryMetadata | undefined {
  const parsed = WorkflowNodeRetryMetadataSchema.safeParse(meta.retry);
  return parsed.success ? parsed.data : undefined;
}
