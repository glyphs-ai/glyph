import { and, eq, inArray, type SQL } from "drizzle-orm";
import { okAsync } from "neverthrow";
import { z } from "zod";
import { TaskOriginSchema } from "../domain/task-origin.js";
import type { DatabaseUnavailable } from "../domain/task-repository.js";
import type { TaskQueries } from "../infrastructure/drizzle/task-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const AggregateByOriginRequestSchema = z
  .object({
    origin: TaskOriginSchema,
    originIds: z.array(z.string()).readonly(),
    statusIn: z.array(z.string()).readonly().optional(),
  })
  .strict();
export type AggregateByOriginRequest = z.infer<typeof AggregateByOriginRequestSchema>;

/** Per-origin aggregate counts for one `originId`. */
interface AggregateByOriginEntry {
  readonly totalCount: number;
  readonly runningCount: number;
}

export type AggregateByOriginResponse = ReadonlyMap<string, AggregateByOriginEntry>;

export type AggregateByOriginError = DatabaseUnavailable;

export interface AggregateByOriginDeps {
  readonly query: TaskQueries;
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
    if (originIds.length === 0) return okAsync(new Map());
    const q = this.deps.query;
    return q
      .query(async (db) => {
        const predicates: SQL[] = [
          eq(q.tasks.origin, origin),
          inArray(q.tasks.originId, [...originIds]),
        ];
        if (statusIn !== undefined && statusIn.length > 0) {
          predicates.push(inArray(q.tasks.status, [...statusIn]));
        }
        return await db
          .select({ originId: q.tasks.originId, status: q.tasks.status })
          .from(q.tasks)
          .where(and(...predicates))
          .all();
      })
      .map((rows) => {
        const map = new Map<string, AggregateByOriginEntry>();
        for (const row of rows) {
          if (row.originId === null) continue;
          const current = map.get(row.originId) ?? { totalCount: 0, runningCount: 0 };
          map.set(row.originId, {
            totalCount: current.totalCount + 1,
            runningCount: current.runningCount + (row.status === "running" ? 1 : 0),
          });
        }
        return map;
      });
  }
}
