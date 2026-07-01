import { z } from "zod";

/**
 * Canonical task id: `YYYYMMDD-xxxxxxxx` (UTC-date prefix + 8 hex chars =
 * 4 random bytes). Branded so a raw string cannot cross a boundary that
 * requires a validated task id. The id is minted in the application layer
 * (`generateTaskId` in `dispatch.ts`); this module owns only the format +
 * brand. Mirrors `@glyphs-ai/session`'s id format so operators see a
 * consistent pattern across both surfaces.
 */
export const TaskIdSchema = z
  .string()
  .regex(/^\d{8}-[0-9a-f]{8}$/, "must be YYYYMMDD-xxxxxxxx")
  .brand("TaskId");

export type TaskId = z.infer<typeof TaskIdSchema>;

/** The caller-supplied value did not match the canonical task-id format. */
export type InvalidTaskId = {
  readonly type: "InvalidTaskId";
  readonly id: unknown;
};
