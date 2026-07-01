import { z } from "zod";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { TaskSupervisor } from "./supervision/index.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteTerminalByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type DeleteTerminalByOriginRequest = z.infer<typeof DeleteTerminalByOriginRequestSchema>;

export interface DeleteTerminalByOriginResponse {
  readonly deletedCount: number;
}

export type DeleteTerminalByOriginError = DatabaseUnavailable;

export interface DeleteTerminalByOriginDeps {
  readonly repository: TaskRepository;
  readonly supervisor: TaskSupervisor;
}

/**
 * Cascade-delete every TERMINAL task with this `(origin, originId)` and
 * enqueue a background workdir purge for each. Origin-agnostic primitive;
 * typed wrappers live in the respective integration package.
 */
export class DeleteTerminalByOriginUseCase
  implements
    UseCase<
      DeleteTerminalByOriginRequest,
      DeleteTerminalByOriginResponse,
      DeleteTerminalByOriginError
    >
{
  constructor(private readonly deps: DeleteTerminalByOriginDeps) {}

  execute(
    request: DeleteTerminalByOriginRequest,
  ): UseCaseResult<DeleteTerminalByOriginResponse, DeleteTerminalByOriginError> {
    const { origin, originId } = DeleteTerminalByOriginRequestSchema.parse(request);
    const supervisor = this.deps.supervisor;
    return this.deps.repository.deleteTerminalByOrigin({ origin, originId }).map((deleted) => {
      for (const task of deleted) supervisor.enqueuePurge(task);
      return { deletedCount: deleted.length };
    });
  }
}
