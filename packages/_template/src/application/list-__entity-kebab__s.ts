import { z } from "zod";
import { __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import type {
  __Entity__Repository,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const List__Entity__sRequestSchema = z.object({}).strict();
export type List__Entity__sRequest = z.infer<typeof List__Entity__sRequestSchema>;

export const List__Entity__sResponseSchema = z.array(
  z.object({
    id: __Entity__IdSchema,
    name: z.string(),
    createdAt: z.string(),
    archived: z.boolean(),
  }),
);
export type List__Entity__sResponse = z.infer<typeof List__Entity__sResponseSchema>;

export type List__Entity__sError = DatabaseUnavailable;

export interface List__Entity__sDeps {
  readonly repo: __Entity__Repository;
}

/** Return every __Entity__ in creation order. */
export class List__Entity__sUseCase
  implements UseCase<List__Entity__sRequest, List__Entity__sResponse, List__Entity__sError>
{
  constructor(private readonly deps: List__Entity__sDeps) {}

  execute(
    request: List__Entity__sRequest,
  ): UseCaseResult<List__Entity__sResponse, List__Entity__sError> {
    List__Entity__sRequestSchema.parse(request);
    return this.deps.repo.list().map((entities) =>
      entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        createdAt: entity.createdAt,
        archived: entity.archived,
      })),
    );
  }
}
