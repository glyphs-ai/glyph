import { z } from "zod";
import type {
  DatabaseUnavailable,
  OriginAggregate,
  TaskRepository,
} from "../domain/task-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const AggregateByOriginRequestSchema = z
  .object({
    origin: z.string(),
    originIds: z.array(z.string()).readonly(),
    statusIn: z.array(z.string()).readonly().optional(),
  })
  .strict();
export type AggregateByOriginRequest = z.infer<typeof AggregateByOriginRequestSchema>;

export type AggregateByOriginResponse = ReadonlyMap<string, OriginAggregate>;

export type AggregateByOriginError = DatabaseUnavailable;

export interface AggregateByOriginDeps {
  readonly repository: TaskRepository;
}

/**
 * Per-`originId` total / running counts for tasks of one `origin`. Powers the
 * schedule / workflow list badges without one query per row.
 */
export class AggregateByOriginUseCase
  implements UseCase<AggregateByOriginRequest, AggregateByOriginResponse, AggregateByOriginError>
{
  constructor(private readonly deps: AggregateByOriginDeps) {}

  execute(
    request: AggregateByOriginRequest,
  ): UseCaseResult<AggregateByOriginResponse, AggregateByOriginError> {
    const { origin, originIds, statusIn } = AggregateByOriginRequestSchema.parse(request);
    return this.deps.repository.aggregateByOrigin({
      origin,
      originIds,
      ...(statusIn !== undefined ? { statusIn } : {}),
    });
  }
}
