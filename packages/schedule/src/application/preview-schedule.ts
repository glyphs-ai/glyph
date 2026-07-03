import { err, ok, okAsync } from "neverthrow";
import { z } from "zod";
import {
  type InvalidCronExpr,
  type InvalidTimezone,
  nextRuns,
  validateCron,
  validateTimezone,
} from "../domain/schedule/cron.js";
import { describeCron } from "../infrastructure/cron/describe.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/** `n` was outside the `[1, 100]` bound (guards against O(n) blow-up). */
export type PreviewCountOutOfRange = {
  readonly type: "PreviewCountOutOfRange";
  readonly n: number;
};

export const PreviewScheduleRequestSchema = z
  .object({
    expr: z.string(),
    tz: z.string(),
    n: z.number().optional(),
  })
  .strict();
export type PreviewScheduleRequest = z.infer<typeof PreviewScheduleRequestSchema>;

export const PreviewScheduleResponseSchema = z.object({
  describe: z.string(),
  nextRuns: z.array(z.string()).readonly(),
});
export type PreviewScheduleResponse = z.infer<typeof PreviewScheduleResponseSchema>;

export type PreviewScheduleError = InvalidCronExpr | InvalidTimezone | PreviewCountOutOfRange;

export interface PreviewScheduleDeps {
  readonly now: () => Date;
}

/**
 * Compute the next `n` fires for `expr` in `tz` plus a human-readable
 * description. `n` is bounded to `[1, 100]`. Pure — touches no DB; the only
 * dependency is the clock for the fire computation.
 */
export class PreviewScheduleUseCase
  implements UseCase<PreviewScheduleRequest, PreviewScheduleResponse, PreviewScheduleError>
{
  constructor(private readonly deps: PreviewScheduleDeps) {}
  execute(
    request: PreviewScheduleRequest,
  ): UseCaseResult<PreviewScheduleResponse, PreviewScheduleError> {
    const parsed = PreviewScheduleRequestSchema.parse(request);
    const deps = this.deps;
    return okAsync<undefined, PreviewScheduleError>(undefined).andThen(() =>
      validateCron(parsed.expr)
        .andThen(() => validateTimezone(parsed.tz))
        .andThen(() => {
          const n = parsed.n ?? 3;
          if (!Number.isInteger(n) || n < 1 || n > 100) {
            return err({ type: "PreviewCountOutOfRange" as const, n });
          }
          return ok({
            describe: describeCron(parsed.expr),
            nextRuns: nextRuns(parsed.expr, parsed.tz, deps.now(), n),
          });
        }),
    );
  }
}
