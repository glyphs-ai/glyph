import { eq } from "drizzle-orm";
import { z } from "zod";
import { type __Entity__Id, __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import { type __Entity__Name, __Entity__NameSchema } from "../domain/__entity-kebab__-name.js";
import type { DatabaseUnavailable } from "../domain/__entity-kebab__-repository.js";
import type { __Entity__Queries } from "../infrastructure/drizzle/__entity-kebab__-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const Get__Entity__RequestSchema = z.object({ id: __Entity__IdSchema }).strict();
export type Get__Entity__Request = z.infer<typeof Get__Entity__RequestSchema>;

export const Get__Entity__ResponseSchema = z
  .object({
    id: __Entity__IdSchema,
    name: __Entity__NameSchema,
    createdAt: z.string(),
    archived: z.boolean(),
  })
  .nullable();
export type Get__Entity__Response = z.infer<typeof Get__Entity__ResponseSchema>;

export type Get__Entity__Error = DatabaseUnavailable;

export interface Get__Entity__Deps {
  readonly query: __Entity__Queries;
}

/** Fetch a __Entity__ by id; absent rows return `null`. */
export class Get__Entity__UseCase
  implements UseCase<Get__Entity__Request, Get__Entity__Response, Get__Entity__Error>
{
  constructor(private readonly deps: Get__Entity__Deps) {}

  execute(request: Get__Entity__Request): UseCaseResult<Get__Entity__Response, Get__Entity__Error> {
    const { id } = Get__Entity__RequestSchema.parse(request);
    const q = this.deps.query;
    return q.query<Get__Entity__Response>(async (db) => {
      const row = await db.select().from(q.__entities__).where(eq(q.__entities__.id, id)).get();
      if (row === undefined) return null;
      return {
        id: row.id as __Entity__Id,
        name: row.name as __Entity__Name,
        createdAt: row.createdAt,
        archived: row.archived,
      };
    });
  }
}
