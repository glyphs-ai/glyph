import { z } from "zod";

/**
 * Upper bound on a workflow `brief`, in characters (after trim). Sized to fit
 * one line in the dashboard list, bound the SQLite column, and keep the
 * displayed workflow title readable across CLI / dashboard. Long content goes
 * in `details`.
 */
const WORKFLOW_BRIEF_MAX_LENGTH = 200;

/**
 * The one-line summary shown for a workflow. Deliberately a distinct brand from
 * the task brief: although the invariant is currently identical (non-empty,
 * single-line, at most {@link WORKFLOW_BRIEF_MAX_LENGTH} characters, trimmed on
 * the way through), a workflow brief and a task brief are different concepts and
 * may diverge — so they carry separate value objects rather than sharing one.
 * Long content belongs in `details`, never `brief`.
 */
export const WorkflowBriefSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "brief must be non-empty after trim")
  .refine(
    (s) => !s.trim().includes("\n") && !s.trim().includes("\r"),
    "brief must be a single line (no newline characters); pass long content via details",
  )
  .refine(
    (s) => s.trim().length <= WORKFLOW_BRIEF_MAX_LENGTH,
    `brief must be ${WORKFLOW_BRIEF_MAX_LENGTH} characters or fewer`,
  )
  .transform((s) => s.trim())
  .brand("WorkflowBrief");
export type WorkflowBrief = z.infer<typeof WorkflowBriefSchema>;
