import type {
  ActivityResult,
  RuntimeActivityReadFailed,
  RuntimeRegistry,
} from "@glyphs-ai/runtime";
import { eq } from "drizzle-orm";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import {
  metaString,
  projectTaskRow,
  type TaskQueries,
} from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/**
 * Hard upper bound on how many activity items a single page may request —
 * a safety cap (guards runaway reads). A property of the read operation, so
 * it lives here and is re-exported for any HTTP/CLI surface that projects
 * this query.
 */
export const TASK_ACTIVITY_MAX_LIMIT = 500;

/** Page size applied when a caller omits `limit` (see the schema default). */
export const TASK_ACTIVITY_DEFAULT_LIMIT = 50;

// Cursors + page size arrive as strings over HTTP query params and as
// numbers from in-process callers; `z.coerce` lets the one schema validate
// both. `id` is the only non-coercible field, so an HTTP surface projects
// the query shape with `.omit({ id: true })`.
const ActivityCursorSchema = z.coerce.number().int().nonnegative();
const ActivityLimitSchema = z.coerce.number().int().min(1).max(TASK_ACTIVITY_MAX_LIMIT);

export const GetTaskActivityRequestSchema = z
  .object({
    id: TaskIdSchema,
    before: ActivityCursorSchema.optional(),
    after: ActivityCursorSchema.optional(),
    limit: ActivityLimitSchema.default(TASK_ACTIVITY_DEFAULT_LIMIT),
  })
  .strict();
// `z.input`, not `z.infer`: `limit` carries a `.default()`, so the caller-facing
// request type keeps it optional (the parse fills it) while the parsed value is
// always a concrete `number`.
export type GetTaskActivityRequest = z.input<typeof GetTaskActivityRequestSchema>;

export type GetTaskActivityResponse = ActivityResult | null;

export type GetTaskActivityError = RuntimeActivityReadFailed | DatabaseUnavailable;

export interface GetTaskActivityDeps {
  readonly query: TaskQueries;
  readonly runtimeRegistry: RuntimeRegistry;
}

/**
 * Fetch a task's activity timeline via the runtime's structured surface.
 * Resolves to `null` (→ route 404) when the task is absent, its runtime is
 * unregistered, the runtime has no structured-log support, or it has no log
 * for this task yet. A genuine read fault after the log was found surfaces
 * `RuntimeActivityReadFailed` (→ route 500). Pagination is forwarded verbatim.
 */
export class GetTaskActivityUseCase
  implements UseCase<GetTaskActivityRequest, GetTaskActivityResponse, GetTaskActivityError>
{
  constructor(private readonly deps: GetTaskActivityDeps) {}

  execute(
    request: GetTaskActivityRequest,
  ): UseCaseResult<GetTaskActivityResponse, GetTaskActivityError> {
    const { id, before, after, limit } = GetTaskActivityRequestSchema.parse(request);
    const deps = this.deps;
    const q = deps.query;
    return q
      .query((db) => {
        const row = db.select().from(q.tasks).where(eq(q.tasks.id, id)).get();
        return row === undefined ? null : projectTaskRow(row);
      })
      .andThen((view) => {
        const nothing = okAsync<GetTaskActivityResponse, GetTaskActivityError>(null);
        if (view === null) return nothing;
        const runtimeName = metaString(view.metadata, "runtime");
        if (runtimeName === undefined) return nothing;
        const runtimeSessionId = metaString(view.metadata, "runtimeSessionId");
        if (runtimeSessionId === undefined) return nothing;
        const found = deps.runtimeRegistry.get(runtimeName);
        if (found.isErr()) return nothing;
        const runtime = found.value;
        if (typeof runtime.readActivity !== "function") return nothing;
        return runtime.readActivity(runtimeSessionId, {
          ...(before !== undefined ? { before } : {}),
          ...(after !== undefined ? { after } : {}),
          limit,
        });
      });
  }
}
