import { errAsync, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type {
  __Entity__AlreadyArchived,
  __Entity__Entity,
} from "../domain/__entity-kebab__-entity.js";
import { __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import type {
  __Entity__NotFound,
  __Entity__Repository,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const Archive__Entity__RequestSchema = z.object({ id: __Entity__IdSchema }).strict();
export type Archive__Entity__Request = z.infer<typeof Archive__Entity__RequestSchema>;

export const Archive__Entity__ResponseSchema = z.object({
  id: __Entity__IdSchema,
  name: z.string(),
  createdAt: z.string(),
  archived: z.boolean(),
});
export type Archive__Entity__Response = z.infer<typeof Archive__Entity__ResponseSchema>;

export type Archive__Entity__Error =
  | __Entity__NotFound
  | __Entity__AlreadyArchived
  | DatabaseUnavailable;

export interface Archive__Entity__Deps {
  readonly repo: __Entity__Repository;
}

/** Load the aggregate, apply the `archive` transition, and persist it. */
export class Archive__Entity__UseCase
  implements UseCase<Archive__Entity__Request, Archive__Entity__Response, Archive__Entity__Error>
{
  constructor(private readonly deps: Archive__Entity__Deps) {}

  async execute(
    request: Archive__Entity__Request,
  ): UseCaseResult<Archive__Entity__Response, Archive__Entity__Error> {
    const { id } = Archive__Entity__RequestSchema.parse(request);
    return this.deps.repo
      .get(id)
      .andThen((entity): ResultAsync<__Entity__Entity, Archive__Entity__Error> => {
        const archived = entity.archive();
        if (archived.isErr()) return errAsync(archived.error);
        return this.deps.repo.save(entity).map(() => entity);
      })
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        createdAt: entity.createdAt,
        archived: entity.archived,
      }));
  }
}
