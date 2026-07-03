import { err, ok, ResultAsync, safeTry } from "neverthrow";
import { z } from "zod";
import { nextRuns } from "../domain/schedule/cron.js";
import type { ScheduleEntity } from "../domain/schedule/schedule-entity.js";
import type {
  InvalidScheduleName,
  ScheduleCorruption,
  ScheduleKindMismatch,
  TargetKindImmutable,
} from "../domain/schedule/schedule-errors.js";
import {
  type InvalidScheduleId,
  parseScheduleId,
  ScheduleIdSchema,
} from "../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleNotFound,
  ScheduleRepository,
} from "../domain/schedule/schedule-repository.js";
import { ScheduleTargetEnvelopeSchema } from "../domain/schedule/schedule-target.js";
import {
  type InvalidCronExpr,
  type InvalidTimezone,
  ScheduleTriggerSchema,
} from "../domain/schedule/schedule-trigger.js";
import type { ScheduleEngine } from "./engine/schedule-engine.js";
import type {
  ScheduleKindNotRegistered,
  TargetValidationFailed,
} from "./ports/schedule-kind-handler.js";
import type { ScheduleKindRegistry } from "./ports/schedule-kind-registry.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const PatchScheduleRequestSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    trigger: ScheduleTriggerSchema.optional(),
    enabled: z.boolean().optional(),
    target: z.object({ patch: z.unknown() }).optional(),
    expectedKind: z.string().optional(),
  })
  .strict();
export type PatchScheduleRequest = z.infer<typeof PatchScheduleRequestSchema>;

export const PatchScheduleResponseSchema = z.object({
  id: ScheduleIdSchema,
  name: z.string(),
  trigger: ScheduleTriggerSchema,
  target: ScheduleTargetEnvelopeSchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastFiredAt: z.string().optional(),
  nextFireAt: z.string().optional(),
});
export type PatchScheduleResponse = z.infer<typeof PatchScheduleResponseSchema>;

export type PatchScheduleError =
  | InvalidScheduleId
  | ScheduleNotFound
  | ScheduleCorruption
  | ScheduleKindMismatch
  | InvalidScheduleName
  | InvalidCronExpr
  | InvalidTimezone
  | ScheduleKindNotRegistered
  | TargetValidationFailed
  | TargetKindImmutable
  | DatabaseUnavailable;

export interface PatchScheduleDeps {
  readonly repo: ScheduleRepository;
  readonly registry: ScheduleKindRegistry;
  readonly engine: ScheduleEngine;
  readonly now: () => Date;
}

/**
 * Patch an existing schedule. Composes {@link ScheduleEntity.withMetadata} /
 * {@link ScheduleEntity.withTrigger} / {@link ScheduleEntity.withTarget} with
 * a single `now` so one logical patch produces exactly one `updatedAt`.
 *
 * `expectedKind` lets kind-discriminated routes (e.g. `PATCH /task/:sid`)
 * reject a mismatch as {@link ScheduleKindMismatch} (projected to a 404).
 * Target patch flow: `handler.mergePatch(existing.data, patch)` (sync) →
 * `handler.validate(merged, { changedKeys })` so cross-checks whose inputs
 * didn't change can be skipped.
 *
 * Re-arms ONLY when `trigger` or `enabled` actually changed — a target-only
 * patch leaves the next-fire schedule untouched.
 */
export class PatchScheduleUseCase
  implements UseCase<PatchScheduleRequest, PatchScheduleResponse, PatchScheduleError>
{
  constructor(private readonly deps: PatchScheduleDeps) {}
  execute(request: PatchScheduleRequest): UseCaseResult<PatchScheduleResponse, PatchScheduleError> {
    const parsed = PatchScheduleRequestSchema.parse(request);
    const deps = this.deps;
    return safeTry<PatchScheduleResponse, PatchScheduleError>(async function* () {
      const id = yield* parseScheduleId(parsed.id);
      const existing = yield* deps.repo.get(id);
      if (parsed.expectedKind !== undefined && existing.target.kind !== parsed.expectedKind) {
        return err({
          type: "ScheduleKindMismatch" as const,
          id,
          expected: parsed.expectedKind,
          actual: existing.target.kind,
        });
      }

      const now = deps.now();
      // Capture originals BEFORE mutating in place: `enabledChanged` compares
      // against the pre-patch value, and the target merge reads the pre-patch
      // envelope. (`withMetadata` edits `enabled` in place; `withTarget` edits
      // the envelope.)
      const originalEnabled = existing.enabled;
      const originalTargetKind = existing.target.kind;
      const originalTargetData = existing.target.data;
      if (parsed.name !== undefined || parsed.enabled !== undefined) {
        yield* existing.withMetadata(
          {
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
          },
          now,
        );
      }
      if (parsed.trigger !== undefined) {
        yield* existing.withTrigger(parsed.trigger, now);
      }
      if (parsed.target !== undefined) {
        const handler = yield* deps.registry.handlerFor(originalTargetKind);
        const { data: merged, changedKeys } = handler.mergePatch(
          originalTargetData,
          parsed.target.patch,
        );
        const validatedMerged = yield* ResultAsync.fromPromise(
          handler.validate(merged, { changedKeys }),
          (cause): TargetValidationFailed => ({
            type: "TargetValidationFailed",
            kind: originalTargetKind,
            cause,
          }),
        );
        yield* existing.withTarget({ kind: originalTargetKind, data: validatedMerged }, now);
      }

      const triggerChanged = parsed.trigger !== undefined;
      const enabledChanged = parsed.enabled !== undefined && parsed.enabled !== originalEnabled;

      if (triggerChanged || enabledChanged) {
        // Re-arming is internal scheduler state, not a user-visible edit, so
        // `withNextFireAt` deliberately does not re-stamp `updatedAt`.
        deps.engine.cancel(id);
        if (existing.enabled) {
          const [nextIso] = nextRuns(existing.trigger.expr, existing.trigger.tz, now, 1);
          existing.withNextFireAt(nextIso);
        } else {
          existing.withNextFireAt(undefined);
        }
      }

      yield* deps.repo.save(existing);

      if (existing.enabled && (triggerChanged || enabledChanged)) {
        deps.engine.arm(existing);
      }
      return ok(toScheduleView(existing));
    });
  }
}

function toScheduleView(entity: ScheduleEntity): PatchScheduleResponse {
  return {
    id: entity.id,
    name: entity.name,
    trigger: entity.trigger,
    target: entity.target,
    enabled: entity.enabled,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    ...(entity.lastFiredAt !== undefined ? { lastFiredAt: entity.lastFiredAt } : {}),
    ...(entity.nextFireAt !== undefined ? { nextFireAt: entity.nextFireAt } : {}),
  };
}
