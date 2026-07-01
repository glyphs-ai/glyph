import { z } from "zod";
import type { DatabaseUnavailable, TaskRepository } from "../domain/task-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const HasInFlightByOriginRequestSchema = z
  .object({ origin: z.string(), originId: z.string() })
  .strict();
export type HasInFlightByOriginRequest = z.infer<typeof HasInFlightByOriginRequestSchema>;

export type HasInFlightByOriginResponse = boolean;

export type HasInFlightByOriginError = DatabaseUnavailable;

export interface HasInFlightByOriginDeps {
  readonly repository: TaskRepository;
}

/**
 * True if any task with this `(origin, originId)` is non-terminal.
 * Origin-agnostic primitive used by integration packages to gate re-dispatch.
 */
export class HasInFlightByOriginUseCase
  implements
    UseCase<HasInFlightByOriginRequest, HasInFlightByOriginResponse, HasInFlightByOriginError>
{
  constructor(private readonly deps: HasInFlightByOriginDeps) {}

  execute(
    request: HasInFlightByOriginRequest,
  ): UseCaseResult<HasInFlightByOriginResponse, HasInFlightByOriginError> {
    const { origin, originId } = HasInFlightByOriginRequestSchema.parse(request);
    return this.deps.repository.hasInFlightByOrigin({ origin, originId });
  }
}
