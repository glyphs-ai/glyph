import { eq } from "drizzle-orm";
import { errAsync } from "neverthrow";
import { z } from "zod";
import {
  type InvalidScheduleId,
  parseScheduleId,
  type ScheduleId,
  ScheduleIdSchema,
} from "../domain/schedule/schedule-id.js";
import type { DatabaseUnavailable } from "../domain/schedule/schedule-repository.js";
import { ScheduleTargetEnvelopeSchema } from "../domain/schedule/schedule-target.js";
import { ScheduleTriggerSchema } from "../domain/schedule/schedule-trigger.js";
import type { ScheduleQueries } from "../infrastructure/drizzle/schedule-queries.js";
import type { ScheduleRow } from "../infrastructure/drizzle/schedule-schema.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetScheduleRequestSchema = z
  .object({ id: z.string(), expectedKind: z.string().optional() })
  .strict();
export type GetScheduleRequest = z.infer<typeof GetScheduleRequestSchema>;

export const GetScheduleResponseSchema = z
  .object({
    id: ScheduleIdSchema,
    name: z.string(),
    trigger: ScheduleTriggerSchema,
    target: ScheduleTargetEnvelopeSchema,
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastFiredAt: z.string().optional(),
    nextFireAt: z.string().optional(),
  })
  .nullable();
export type GetScheduleResponse = z.infer<typeof GetScheduleResponseSchema>;

export type GetScheduleError = InvalidScheduleId | DatabaseUnavailable;

export interface GetScheduleDeps {
  readonly query: ScheduleQueries;
}

/** Read one schedule by id. Returns `null` when the row is absent. */
export class GetScheduleUseCase
  implements UseCase<GetScheduleRequest, GetScheduleResponse, GetScheduleError>
{
  constructor(private readonly deps: GetScheduleDeps) {}
  execute(request: GetScheduleRequest): UseCaseResult<GetScheduleResponse, GetScheduleError> {
    const parsed = GetScheduleRequestSchema.parse(request);
    const idResult = parseScheduleId(parsed.id);
    if (idResult.isErr()) return errAsync(idResult.error);
    const id = idResult.value;
    const q = this.deps.query;
    return q.query((db) => {
      const row = db.select().from(q.schedules).where(eq(q.schedules.id, id)).get();
      if (row === undefined) return null;
      // A kind-scoped read (e.g. GET /schedules/task/:sid) treats a row of a
      // different kind as absent, so the wire never leaks the actual kind.
      if (parsed.expectedKind !== undefined && row.targetKind !== parsed.expectedKind) return null;
      return toScheduleView(row);
    });
  }
}

function toScheduleView(row: ScheduleRow): NonNullable<GetScheduleResponse> {
  return {
    id: row.id as ScheduleId,
    name: row.name,
    trigger: { kind: "cron", expr: row.triggerExpr, tz: row.triggerTz },
    target: { kind: row.targetKind, data: parseJsonValue(row.targetJson) },
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.lastFiredAt !== null ? { lastFiredAt: row.lastFiredAt } : {}),
    ...(row.nextFireAt !== null ? { nextFireAt: row.nextFireAt } : {}),
  };
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
