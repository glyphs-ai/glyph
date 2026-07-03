import { ok, type Result } from "neverthrow";
import { z } from "zod";
import {
  type InvalidCronExpr,
  type InvalidTimezone,
  validateCron,
  validateTimezone,
} from "./cron.js";

export type { InvalidCronExpr, InvalidTimezone } from "./cron.js";

/**
 * Trigger value object. Closed discriminated union — only `cron` today,
 * discriminated by `kind` so future trigger kinds slot in without
 * widening existing call sites.
 *
 * The Zod schema enforces STRUCTURE (kind literal + string fields); the
 * domain-level cron legality (a real 5-field POSIX expr + valid IANA tz)
 * is enforced by {@link validateTrigger}, which the entity's factory and
 * `withTrigger` call so a persisted trigger is always well-formed.
 */
export const ScheduleTriggerSchema = z
  .object({
    kind: z.literal("cron"),
    expr: z.string(),
    tz: z.string(),
  })
  .strict();

export type ScheduleTrigger = z.infer<typeof ScheduleTriggerSchema>;

/**
 * Enforce cron legality on a trigger. Delegates to the {@link validateCron}
 * / {@link validateTimezone} domain cron service — the single source of
 * truth for what croner will accept and compute.
 */
export function validateTrigger(
  trigger: ScheduleTrigger,
): Result<void, InvalidCronExpr | InvalidTimezone> {
  return validateCron(trigger.expr)
    .andThen(() => validateTimezone(trigger.tz))
    .andThen(() => ok(undefined));
}
