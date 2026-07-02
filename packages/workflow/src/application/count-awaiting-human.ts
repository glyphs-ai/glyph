import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseUnavailable } from "../domain/workflow/workflow-repository.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CountAwaitingHumanRequestSchema = z.object({}).strict().default({});
export type CountAwaitingHumanRequest = z.infer<typeof CountAwaitingHumanRequestSchema>;
export const CountAwaitingHumanResponseSchema = z.record(z.string(), z.number());
export type CountAwaitingHumanResponse = z.infer<typeof CountAwaitingHumanResponseSchema>;
export type CountAwaitingHumanError = DatabaseUnavailable;
export interface CountAwaitingHumanDeps {
  readonly query: WorkflowQueries;
}
export class CountAwaitingHumanUseCase
  implements
    UseCase<
      CountAwaitingHumanRequest | undefined,
      CountAwaitingHumanResponse,
      CountAwaitingHumanError
    >
{
  constructor(private readonly deps: CountAwaitingHumanDeps) {}
  execute(
    request: CountAwaitingHumanRequest | undefined = {},
  ): UseCaseResult<CountAwaitingHumanResponse, CountAwaitingHumanError> {
    CountAwaitingHumanRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query((db) => {
      const rows = db
        .select({ workflowId: q.workflowNodes.workflowId, count: count() })
        .from(q.workflowNodes)
        .where(and(eq(q.workflowNodes.kind, "human"), eq(q.workflowNodes.status, "running")))
        .groupBy(q.workflowNodes.workflowId)
        .all();
      return Object.fromEntries(rows.map((row) => [row.workflowId, Number(row.count)]));
    });
  }
}
