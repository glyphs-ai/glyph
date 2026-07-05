import { z } from "zod";

/**
 * Why a task ended in `failed` status, discriminated by `kind`:
 *  - `execution` — the subprocess ended unsuccessfully; carries `exitCode` or
 *    `signal`. The entity enforces exactly-one-of at the storage boundary; the
 *    wire schema leaves both optional (Zod cannot express the exclusivity).
 *  - `internal`  — a manager-side fault (e.g. an exit-watcher rejection).
 *  - `cascade`   — an external lifecycle event (server shutdown, orphan recovery).
 */
export const TaskFailureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("execution"),
    exitCode: z.number().optional(),
    signal: z.string().optional(),
    message: z.string(),
  }),
  z.object({ kind: z.literal("internal"), message: z.string() }),
  z.object({ kind: z.literal("cascade"), message: z.string() }),
]);
export type TaskFailure = z.infer<typeof TaskFailureSchema>;
