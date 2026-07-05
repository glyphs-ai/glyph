import { z } from "zod";

/**
 * Status lifecycle: `running → succeeded | failed | cancelled`. Tasks are
 * created directly in `running` (no intermediate state between dispatch and the
 * subprocess starting); the exit watcher / cancel path is the only producer of
 * a terminal transition.
 */
export const TaskStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** A status from which no further transitions are legal. */
export type TerminalStatus = Exclude<TaskStatus, "running">;

/**
 * Runtime list of every {@link TerminalStatus}, kept in lock-step with the type
 * via `satisfies`. The repository / application layers use it to express "task
 * is *not* terminal" without hard-coding `"running"`.
 */
export const TERMINAL_TASK_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly TerminalStatus[];
