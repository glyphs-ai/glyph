import { z } from "zod";

/** Closed set of substrate-detected workflow failure codes. */
export const WorkflowSubstrateFailureReasonSchema = z.enum(["STUCK_RETRY_LIMIT"]);
export type WorkflowSubstrateFailureReason = z.infer<typeof WorkflowSubstrateFailureReasonSchema>;

/** Payload attached when a workflow transitions to `failed`. */
export const WorkflowFailureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinator"), message: z.string() }),
  z.object({
    kind: z.literal("substrate"),
    reason: WorkflowSubstrateFailureReasonSchema,
    message: z.string(),
  }),
]);
export type WorkflowFailure = z.infer<typeof WorkflowFailureSchema>;
