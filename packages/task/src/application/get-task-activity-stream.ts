import type { ActivityItem, RuntimeRegistry } from "@glyphs-ai/runtime";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import {
  metaString,
  projectTaskRow,
  type TaskQueries,
} from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetTaskActivityStreamRequestSchema = z
  .object({
    id: TaskIdSchema,
    after: z.number().optional(),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();
export type GetTaskActivityStreamRequest = z.infer<typeof GetTaskActivityStreamRequestSchema>;

export type GetTaskActivityStreamResponse = AsyncIterable<ActivityItem> | null;

export type GetTaskActivityStreamError = DatabaseUnavailable;

export interface GetTaskActivityStreamDeps {
  readonly query: TaskQueries;
  readonly runtimeRegistry: RuntimeRegistry;
}

/**
 * Live-tail variant of {@link GetTaskActivityUseCase}. Resolves to the
 * runtime's `streamActivity` iterable, or `null` when the task is absent,
 * already terminal (nothing left to tail), its runtime is unregistered, or
 * the runtime has no streaming support. The caller closes the stream via
 * `signal` on client disconnect.
 */
export class GetTaskActivityStreamUseCase
  implements
    UseCase<GetTaskActivityStreamRequest, GetTaskActivityStreamResponse, GetTaskActivityStreamError>
{
  constructor(private readonly deps: GetTaskActivityStreamDeps) {}

  execute(
    request: GetTaskActivityStreamRequest,
  ): UseCaseResult<GetTaskActivityStreamResponse, GetTaskActivityStreamError> {
    const { id, after, signal } = GetTaskActivityStreamRequestSchema.parse(request);
    const deps = this.deps;
    const q = deps.query;
    return q
      .query(async (db) => {
        const row = await db.select().from(q.tasks).where(eq(q.tasks.id, id)).get();
        return row === undefined ? null : projectTaskRow(row);
      })
      .map((view): GetTaskActivityStreamResponse => {
        if (view === null) return null;
        // Streaming a terminal task is wasted work — force callers to the
        // one-shot endpoint for post-mortem reads.
        if (view.status !== "running") return null;
        const runtimeName = metaString(view.metadata, "runtime");
        if (runtimeName === undefined) return null;
        const runtimeSessionId = metaString(view.metadata, "runtimeSessionId");
        if (runtimeSessionId === undefined) return null;
        const found = deps.runtimeRegistry.get(runtimeName);
        if (found.isErr()) return null;
        const runtime = found.value;
        if (typeof runtime.streamActivity !== "function") return null;
        return runtime.streamActivity(runtimeSessionId, {
          ...(after !== undefined ? { after } : {}),
          ...(signal !== undefined ? { signal } : {}),
        });
      });
  }
}
