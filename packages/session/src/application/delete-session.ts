import type {
  RuntimeRegistry,
  RuntimeStateDeletionFailed,
  UnknownRuntime,
} from "@glyphs-ai/runtime-v2";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { SessionIdSchema } from "../domain/session-id.js";
import type {
  DatabaseUnavailable,
  SessionNotFound,
  SessionRepository,
} from "../domain/session-repository.js";
import type { SandboxRemovalFailed, SessionSandbox } from "../domain/session-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteSessionRequestSchema = z
  .object({ id: SessionIdSchema, purge: z.boolean().optional() })
  .strict();
export type DeleteSessionRequest = z.infer<typeof DeleteSessionRequestSchema>;

export const DeleteSessionResponseSchema = z.void();
export type DeleteSessionResponse = void;

export type DeleteSessionError =
  | SessionNotFound
  | UnknownRuntime
  | RuntimeStateDeletionFailed
  | SandboxRemovalFailed
  | DatabaseUnavailable;

export interface DeleteSessionDeps {
  readonly repo: SessionRepository;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly sandbox: SessionSandbox;
}

/**
 * Delete a session. Default (archive) drops only the registry row;
 * `purge` also drops the runtime's per-session state and the sandbox.
 */
export class DeleteSessionUseCase
  implements UseCase<DeleteSessionRequest, DeleteSessionResponse, DeleteSessionError>
{
  constructor(private readonly deps: DeleteSessionDeps) {}

  execute(request: DeleteSessionRequest): UseCaseResult<DeleteSessionResponse, DeleteSessionError> {
    const { id, purge } = DeleteSessionRequestSchema.parse(request);
    const deps = this.deps;
    return deps.repo.get(id).andThen((entity) => {
      if (purge !== true) return deps.repo.delete(id);
      const rsid = entity.runtimeSessionId;
      const dropState =
        rsid !== null
          ? deps.runtimeRegistry.get(entity.runtime).asyncAndThen((rt) => rt.deleteState(rsid))
          : okAsync<void, UnknownRuntime | RuntimeStateDeletionFailed>(undefined);
      return dropState.andThen(() => deps.sandbox.remove(id)).andThen(() => deps.repo.delete(id));
    });
  }
}
