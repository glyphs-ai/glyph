import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";
import { nextRuns } from "../domain/schedule/cron.js";
import { ScheduleEntity } from "../domain/schedule/schedule-entity.js";
import type { InvalidScheduleName } from "../domain/schedule/schedule-errors.js";
import { generateScheduleId, ScheduleIdSchema } from "../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleRepository,
} from "../domain/schedule/schedule-repository.js";
import { ScheduleTargetEnvelopeSchema } from "../domain/schedule/schedule-target.js";
import {
  type InvalidCronExpr,
  type InvalidTimezone,
  ScheduleTriggerSchema,
  validateTrigger,
} from "../domain/schedule/schedule-trigger.js";
import type { ScheduleEngine } from "./engine/schedule-engine.js";
import type {
  ScheduleKindNotRegistered,
  TargetValidationFailed,
} from "./ports/schedule-kind-handler.js";
import type { ScheduleKindRegistry } from "./ports/schedule-kind-registry.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CreateScheduleRequestSchema = z
  .object({
    name: z.string(),
    trigger: ScheduleTriggerSchema,
    target: ScheduleTargetEnvelopeSchema,
    enabled: z.boolean().optional(),
  })
  .strict();
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;

export const CreateScheduleResponseSchema = z.object({
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
export type CreateScheduleResponse = z.infer<typeof CreateScheduleResponseSchema>;

export type CreateScheduleError =
  | InvalidScheduleName
  | InvalidCronExpr
  | InvalidTimezone
  | ScheduleKindNotRegistered
  | TargetValidationFailed
  | DatabaseUnavailable;

export interface CreateScheduleDeps {
  readonly repo: ScheduleRepository;
  readonly registry: ScheduleKindRegistry;
  readonly engine: ScheduleEngine;
  readonly now: () => Date;
  readonly randomUUID: () => string;
}

/**
 * Create a schedule of any registered kind. Order matters:
 *   1. Sync schedule-level invariants (trigger + name) — fail-fast BEFORE any
 *      handler so a malformed shape never reaches the handler's (possibly
 *      catalog-hitting) `validate` as a misleading not-found.
 *   2. Handler lookup — `ScheduleKindNotRegistered` if the kind is unknown.
 *   3. `handler.validate(data)` — handler-owned shape check + cross-checks.
 *   4. Construct the entity (re-validates, defense in depth), pre-compute
 *      `nextFireAt` when enabled so the list ORDER BY sorts the fresh row.
 *   5. Insert, then arm only when enabled.
 */
export class CreateScheduleUseCase
  implements UseCase<CreateScheduleRequest, CreateScheduleResponse, CreateScheduleError>
{
  constructor(private readonly deps: CreateScheduleDeps) {}
  execute(
    request: CreateScheduleRequest,
  ): UseCaseResult<CreateScheduleResponse, CreateScheduleError> {
    const parsed = CreateScheduleRequestSchema.parse(request);
    const deps = this.deps;
    return safeTry<CreateScheduleResponse, CreateScheduleError>(async function* () {
      yield* validateTrigger(parsed.trigger);
      if (!isNonEmptyName(parsed.name)) return err({ type: "InvalidScheduleName" as const });
      const handler = yield* deps.registry.handlerFor(parsed.target.kind);
      const validatedData = yield* handler.validate(parsed.target.data).mapErr(
        (fault): TargetValidationFailed => ({
          type: "TargetValidationFailed",
          kind: parsed.target.kind,
          cause: fault.cause,
        }),
      );
      const id = generateScheduleId(deps.randomUUID);
      const now = deps.now();
      const created = yield* ScheduleEntity.create(
        {
          name: parsed.name,
          trigger: parsed.trigger,
          target: { kind: parsed.target.kind, data: validatedData },
          ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        },
        { id, now },
      );
      const entity = created;
      if (entity.enabled) {
        const [nextIso] = nextRuns(entity.trigger.expr, entity.trigger.tz, now, 1);
        entity.withNextFireAt(nextIso);
      }
      yield* deps.repo.save(entity);
      if (entity.enabled) deps.engine.arm(entity);
      return ok({
        id: entity.id,
        name: entity.name,
        trigger: entity.trigger,
        target: entity.target,
        enabled: entity.enabled,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        ...(entity.lastFiredAt !== undefined ? { lastFiredAt: entity.lastFiredAt } : {}),
        ...(entity.nextFireAt !== undefined ? { nextFireAt: entity.nextFireAt } : {}),
      });
    });
  }
}

function isNonEmptyName(name: string): boolean {
  return name.trim().length > 0;
}
