import { z } from "zod";

/**
 * Upper bound on a task `brief`, in characters (after trim). Sized to fit one
 * line in the dashboard list, bound the SQLite column, and keep the displayed
 * task title readable across CLI / dashboard. Long content goes in `details`.
 */
const TASK_BRIEF_MAX_LENGTH = 200;

/**
 * The one-line summary shown for a task. The single source of truth for the
 * brief invariant enforced at every dispatch entry point (HTTP route, workflow
 * worker, schedule target): non-empty, single-line, and at most
 * {@link TASK_BRIEF_MAX_LENGTH} characters — trimmed on the way through. Long
 * content belongs in `details`, never `brief`.
 */
export const TaskBriefSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "brief must be non-empty after trim")
  .refine(
    (s) => !s.trim().includes("\n") && !s.trim().includes("\r"),
    "brief must be a single line (no newline characters); pass long content via details",
  )
  .refine(
    (s) => s.trim().length <= TASK_BRIEF_MAX_LENGTH,
    `brief must be ${TASK_BRIEF_MAX_LENGTH} characters or fewer`,
  )
  .transform((s) => s.trim())
  .brand("TaskBrief");
export type TaskBrief = z.infer<typeof TaskBriefSchema>;
