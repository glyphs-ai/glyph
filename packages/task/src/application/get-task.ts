import type { RuntimeRegistry } from "@glyphs-ai/runtime";
import { eq } from "drizzle-orm";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { TaskCancellationSchema } from "../domain/task-cancellation.js";
import { TaskFailureSchema } from "../domain/task-failure.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import { TaskStatusSchema } from "../domain/task-status.js";
import { TaskSuccessSchema } from "../domain/task-success.js";
import {
  metaString,
  projectTaskRow,
  type TaskQueries,
} from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetTaskRequestSchema = z.object({ id: TaskIdSchema }).strict();
export type GetTaskRequest = z.infer<typeof GetTaskRequestSchema>;

export const GetTaskResponseSchema = z
  .object({
    id: TaskIdSchema,
    agent: z.string(),
    brief: z.string(),
    details: z.string().optional(),
    origin: z.string(),
    originId: z.string().optional(),
    status: TaskStatusSchema,
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    success: TaskSuccessSchema.optional(),
    failure: TaskFailureSchema.optional(),
    cancellation: TaskCancellationSchema.optional(),
  })
  .strict()
  .nullable();
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;

export type GetTaskError = DatabaseUnavailable;

export interface GetTaskDeps {
  readonly query: TaskQueries;
  readonly runtimeRegistry: RuntimeRegistry;
}

/**
 * Read one task by id; `null` when absent. A running task is enriched with
 * the runtime's live `lastActiveAtRuntime` (best-effort — a runtime fault or
 * unregistered runtime leaves the task unenriched). Terminal tasks are
 * returned as-is because their runtime state dir may already be purged.
 */
export class GetTaskUseCase implements UseCase<GetTaskRequest, GetTaskResponse, GetTaskError> {
  constructor(private readonly deps: GetTaskDeps) {}

  execute(request: GetTaskRequest): UseCaseResult<GetTaskResponse, GetTaskError> {
    const { id } = GetTaskRequestSchema.parse(request);
    const deps = this.deps;
    const q = deps.query;
    return q
      .query(async (db): Promise<GetTaskResponse> => {
        const row = await db.select().from(q.tasks).where(eq(q.tasks.id, id)).get();
        return row === undefined ? null : projectTaskRow(row);
      })
      .andThen((view) => {
        if (view === null || view.status !== "running") return okAsync<GetTaskResponse>(view);
        return runtimeLastActiveAt(deps, view).map(
          (lastActiveAt): GetTaskResponse =>
            lastActiveAt === null
              ? view
              : { ...view, metadata: { ...view.metadata, lastActiveAtRuntime: lastActiveAt } },
        );
      });
  }
}

/**
 * Read the runtime's live `lastActiveAt` for a running task, or `null` when
 * the runtime is unregistered, the task has no session id, or the runtime
 * reports no activity. Never mutates the view — the caller folds the value in.
 */
function runtimeLastActiveAt(
  deps: GetTaskDeps,
  view: NonNullable<GetTaskResponse>,
): UseCaseResult<string | null, never> {
  const runtimeName = metaString(view.metadata, "runtime");
  if (runtimeName === undefined) return okAsync(null);
  const found = deps.runtimeRegistry.get(runtimeName);
  if (found.isErr()) return okAsync(null);
  const runtimeSessionId = metaString(view.metadata, "runtimeSessionId");
  if (runtimeSessionId === undefined) return okAsync(null);
  // readMetadata is best-effort (never-failing Result) — a runtime fault
  // resolves to null rather than breaking the read.
  return found.value
    .readMetadata(runtimeSessionId)
    .map((meta): string | null =>
      meta === null || meta.lastActiveAt === null ? null : meta.lastActiveAt,
    );
}
