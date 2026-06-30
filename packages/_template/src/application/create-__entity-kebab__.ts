import { randomUUID } from "node:crypto";
import { z } from "zod";
import { __Entity__Entity } from "../domain/__entity-kebab__-entity.js";
import { type __Entity__Id, __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import type {
  __Entity__IdConflict,
  __Entity__Repository,
  DatabaseUnavailable,
} from "../domain/__entity-kebab__-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const Create__Entity__RequestSchema = z.object({ name: z.string().min(1) }).strict();
export type Create__Entity__Request = z.infer<typeof Create__Entity__RequestSchema>;

export const Create__Entity__ResponseSchema = z.object({
  id: __Entity__IdSchema,
  name: z.string(),
  createdAt: z.string(),
  archived: z.boolean(),
});
export type Create__Entity__Response = z.infer<typeof Create__Entity__ResponseSchema>;

export type Create__Entity__Error = __Entity__IdConflict | DatabaseUnavailable;

export interface Create__Entity__Deps {
  readonly repo: __Entity__Repository;
}

/** Mint a fresh __Entity__ and persist it. */
export class Create__Entity__UseCase
  implements UseCase<Create__Entity__Request, Create__Entity__Response, Create__Entity__Error>
{
  constructor(private readonly deps: Create__Entity__Deps) {}

  execute(
    request: Create__Entity__Request,
  ): UseCaseResult<Create__Entity__Response, Create__Entity__Error> {
    const { name } = Create__Entity__RequestSchema.parse(request);
    // Cast at the mint boundary: `randomUUID()` satisfies the UUID brand.
    const entity = __Entity__Entity.create({
      id: randomUUID() as __Entity__Id,
      name,
      now: new Date().toISOString(),
    });
    return this.deps.repo.insert(entity).map(() => ({
      id: entity.id,
      name: entity.name,
      createdAt: entity.createdAt,
      archived: entity.archived,
    }));
  }
}
