import { and, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type ScheduleId, ScheduleIdSchema } from "../domain/schedule/schedule-id.js";
import type { DatabaseUnavailable } from "../domain/schedule/schedule-repository.js";
import { ScheduleTargetEnvelopeSchema } from "../domain/schedule/schedule-target.js";
import { ScheduleTriggerSchema } from "../domain/schedule/schedule-trigger.js";
import type { ScheduleQueries } from "../infrastructure/drizzle/schedule-queries.js";
import type { ScheduleRow } from "../infrastructure/drizzle/schedule-schema.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/**
 * JSON-path grammar accepted by `dataEquals.path`. Defends the
 * `json_extract(target_json, <path>) = ?` SQL fragment from injection — the
 * path is string-concatenated into the Drizzle `sql` template (Drizzle
 * parameterises only `?`-placeholder values, not the `json_extract` first
 * argument). Grammar: `$` + one or more `.field` segments.
 */
const JSON_PATH_RE = /^\$(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

export const ListSchedulesRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    kind: z.string().optional(),
    dataEquals: z
      .object({
        path: z.string().regex(JSON_PATH_RE),
        value: z.union([z.string(), z.number(), z.boolean()]),
      })
      .optional(),
  })
  .strict()
  .default({});
export type ListSchedulesRequest = z.infer<typeof ListSchedulesRequestSchema>;

export const ListSchedulesResponseSchema = z
  .array(
    z.object({
      id: ScheduleIdSchema,
      name: z.string(),
      trigger: ScheduleTriggerSchema,
      target: ScheduleTargetEnvelopeSchema,
      enabled: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
      lastFiredAt: z.string().optional(),
      nextFireAt: z.string().optional(),
    }),
  )
  .readonly();
export type ListSchedulesResponse = z.infer<typeof ListSchedulesResponseSchema>;

export type ListSchedulesError = DatabaseUnavailable;

export interface ListSchedulesDeps {
  readonly query: ScheduleQueries;
}

/**
 * List schedules with AND-combined filters:
 *   - `enabled`: equality on the `enabled` column.
 *   - `kind`: equality on `target_kind` (engages the partial JSON index when
 *     combined with a `dataEquals` on `$.agent`).
 *   - `dataEquals`: generic equality on a JSON path inside `target_json`; the
 *     `path` is grammar-guarded (SQL-injection defence), the `value` is
 *     parameter-bound.
 * Ordered `next_fire_at ASC NULLS LAST` (newest-armed first, never-armed last).
 */
export class ListSchedulesUseCase
  implements UseCase<ListSchedulesRequest | undefined, ListSchedulesResponse, ListSchedulesError>
{
  constructor(private readonly deps: ListSchedulesDeps) {}
  execute(
    request: ListSchedulesRequest | undefined = {},
  ): UseCaseResult<ListSchedulesResponse, ListSchedulesError> {
    const parsed = ListSchedulesRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query((db) => {
      const conditions: SQL[] = [];
      if (parsed.enabled !== undefined) conditions.push(eq(q.schedules.enabled, parsed.enabled));
      if (parsed.kind !== undefined) conditions.push(eq(q.schedules.targetKind, parsed.kind));
      if (parsed.dataEquals !== undefined) {
        const path = parsed.dataEquals.path;
        conditions.push(
          sql`json_extract(${q.schedules.targetJson}, ${path}) = ${parsed.dataEquals.value}`,
        );
      }
      const base = db.select().from(q.schedules);
      const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
      const rows = filtered.orderBy(sql`${q.schedules.nextFireAt} ASC NULLS LAST`).all();
      return rows.map(toScheduleView);
    });
  }
}

function toScheduleView(row: ScheduleRow): ListSchedulesResponse[number] {
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
