import { randomUUID as cryptoRandomUUID } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

/**
 * Canonical schedule id: UUID v4. Unlike task/session/workflow's
 * `YYYYMMDD-xxxxxxxx` form, schedule has no on-disk workdir whose `ls`
 * grouping benefits from a date prefix, so a plain UUID v4 is enough.
 * Generation stays in the application layer; the domain owns the format
 * and the brand used at boundaries.
 */
export const ScheduleIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "must be a UUID v4",
  )
  .brand("ScheduleId");

export type ScheduleId = z.infer<typeof ScheduleIdSchema>;

/** The caller-supplied value did not match the canonical schedule-id format. */
export type InvalidScheduleId = {
  readonly type: "InvalidScheduleId";
  readonly id: unknown;
};

/**
 * Schedule id generator — a fresh UUID v4. `randomUUID` is an injectable
 * seam so tests can produce deterministic ids by stubbing it.
 */
export function generateScheduleId(randomUUID: () => string = cryptoRandomUUID): ScheduleId {
  return ScheduleIdSchema.parse(randomUUID());
}

/**
 * Brand a caller-supplied id at a use-case boundary, or {@link InvalidScheduleId}
 * when it does not match the canonical format.
 */
export function parseScheduleId(id: unknown): Result<ScheduleId, InvalidScheduleId> {
  const parsed = ScheduleIdSchema.safeParse(id);
  return parsed.success ? ok(parsed.data) : err({ type: "InvalidScheduleId", id });
}
