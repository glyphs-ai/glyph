import { z } from "zod";
import { __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import type {
  __Entity__NotFound,
  __Entity__Repository,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const Get__Entity__RequestSchema = z.object({ id: __Entity__IdSchema }).strict();
export type Get__Entity__Request = z.infer<typeof Get__Entity__RequestSchema>;

export const Get__Entity__ResponseSchema = z.object({
  id: __Entity__IdSchema,
  name: z.string(),
  createdAt: z.string(),
  archived: z.boolean(),
});
export type Get__Entity__Response = z.infer<typeof Get__Entity__ResponseSchema>;

export type Get__Entity__Error = __Entity__NotFound | DatabaseUnavailable;

export interface Get__Entity__Deps {
  readonly repo: __Entity__Repository;
}

/** Fetch a __Entity__ by id; absence is a `__Entity__NotFound` error. */
export class Get__Entity__UseCase
  implements UseCase<Get__Entity__Request, Get__Entity__Response, Get__Entity__Error>
{
  constructor(private readonly deps: Get__Entity__Deps) {}

  async execute(
    request: Get__Entity__Request,
  ): UseCaseResult<Get__Entity__Response, Get__Entity__Error> {
    const { id } = Get__Entity__RequestSchema.parse(request);
    return this.deps.repo.get(id).map((entity) => ({
      id: entity.id,
      name: entity.name,
      createdAt: entity.createdAt,
      archived: entity.archived,
    }));
  }
}
