import type {
  ActivityResult,
  RuntimeActivityReadFailed,
  RuntimeRegistry,
} from "@glyphs-ai/runtime";
import { okAsync } from "neverthrow";
import { z } from "zod";
import type { CorruptedTask } from "../domain/task-entity.js";
import { TaskIdSchema } from "../domain/task-id.js";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetTaskActivityRequestSchema = z
  .object({
    id: TaskIdSchema,
    before: z.number().optional(),
    after: z.number().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type GetTaskActivityRequest = z.infer<typeof GetTaskActivityRequestSchema>;

export type GetTaskActivityResponse = ActivityResult | null;

export type GetTaskActivityError = RuntimeActivityReadFailed | CorruptedTask | DatabaseUnavailable;

export interface GetTaskActivityDeps {
  readonly repository: TaskRepository;
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
    return deps.repository.findById(id).andThen((task) => {
      const nothing = okAsync<GetTaskActivityResponse, GetTaskActivityError>(null);
      if (task === undefined) return nothing;
      const runtimeName = task.metadataString("runtime");
      if (runtimeName === undefined) return nothing;
      const runtimeSessionId = task.metadataString("runtimeSessionId");
      if (runtimeSessionId === undefined) return nothing;
      const found = deps.runtimeRegistry.get(runtimeName);
      if (found.isErr()) return nothing;
      const runtime = found.value;
      if (typeof runtime.readActivity !== "function") return nothing;
      return runtime.readActivity(runtimeSessionId, {
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
    });
  }
}
