import { z } from "zod";
import { type __Entity__Id, __Entity__IdSchema } from "../domain/__entity-kebab__-id.js";
import { type __Entity__Name, __Entity__NameSchema } from "../domain/__entity-kebab__-name.js";
import type { DatabaseUnavailable } from "../domain/__entity-kebab__-repository.js";
import type { __Entity__Queries } from "../infrastructure/drizzle/__entity-kebab__-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const List__Entity__sRequestSchema = z.object({}).strict();
export type List__Entity__sRequest = z.infer<typeof List__Entity__sRequestSchema>;

export const List__Entity__sResponseSchema = z.array(
  z.object({
    id: __Entity__IdSchema,
    name: __Entity__NameSchema,
    createdAt: z.string(),
    archived: z.boolean(),
  }),
);
export type List__Entity__sResponse = z.infer<typeof List__Entity__sResponseSchema>;

export type List__Entity__sError = DatabaseUnavailable;

export interface List__Entity__sDeps {
  readonly query: __Entity__Queries;
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
    const q = this.deps.query;
    return q.query<List__Entity__sResponse>(async (db) => {
      const rows = await db.select().from(q.__entities__).orderBy(q.__entities__.createdAt).all();
      return rows.map((row) => ({
        id: row.id as __Entity__Id,
        name: row.name as __Entity__Name,
        createdAt: row.createdAt,
        archived: row.archived,
      }));
    });
  }
}
