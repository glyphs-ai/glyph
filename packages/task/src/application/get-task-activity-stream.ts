import type { ActivityItem, RuntimeRegistry } from "@glyphs-ai/runtime";
import { okAsync } from "neverthrow";
import { z } from "zod";
import type { CorruptedTask } from "../domain/task-entity.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
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

export type GetTaskActivityStreamError = CorruptedTask | DatabaseUnavailable;

export interface GetTaskActivityStreamDeps {
  readonly repository: TaskRepository;
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
    return deps.repository.findById(id).andThen((task) => {
      const nothing = okAsync<GetTaskActivityStreamResponse, GetTaskActivityStreamError>(null);
      // Streaming a terminal task is wasted work — force callers to the
      // one-shot endpoint for post-mortem reads.
      if (task === undefined || task.status !== "running") return nothing;
      const runtimeName = task.metadataString("runtime");
      if (runtimeName === undefined) return nothing;
      const runtimeSessionId = task.metadataString("runtimeSessionId");
      if (runtimeSessionId === undefined) return nothing;
      const found = deps.runtimeRegistry.get(runtimeName);
      if (found.isErr()) return nothing;
      const runtime = found.value;
      if (typeof runtime.streamActivity !== "function") return nothing;
      return okAsync<GetTaskActivityStreamResponse, GetTaskActivityStreamError>(
        runtime.streamActivity(runtimeSessionId, {
          ...(after !== undefined ? { after } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
      );
    });
  }
}
