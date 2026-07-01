import { z } from "zod";

/**
 * Payload attached when a task transitions to `succeeded`. Populated at terminal
 * time and persisted verbatim — never re-derived on read.
 */
export const TaskSuccessSchema = z.object({
  /**
   * Head of the agent's last assistant utterance (capped). `null` when the
   * agent finished without an assistant turn or the runtime's activity surface
   * was unavailable — distinct from `""` (an explicitly empty turn).
   */
  output: z.string().nullable(),
  /** Absolute paths of `<workdir>/artifact/` files, ordered lexicographically by basename. */
  artifacts: z.array(z.string()).readonly().optional(),
});
export type TaskSuccess = z.infer<typeof TaskSuccessSchema>;
