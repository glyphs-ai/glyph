import { z } from "zod";

/**
 * Why a task ended in `cancelled` status: `user` (a cancel request killed a live
 * subprocess) or `cascade` (a side-effect of another manager-side event, e.g.
 * orphan reconciliation).
 */
export const TaskCancellationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), message: z.string() }),
  z.object({ kind: z.literal("cascade"), message: z.string() }),
]);
export type TaskCancellation = z.infer<typeof TaskCancellationSchema>;
