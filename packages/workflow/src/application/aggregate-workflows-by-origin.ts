import { and, count, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseUnavailable } from "../domain/workflow/workflow-repository.js";
import { WorkflowStatusSchema } from "../domain/workflow/workflow-status.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const OriginAggregateSchema = z.object({
  totalCount: z.number(),
  runningCount: z.number(),
  awaitingCount: z.number(),
});

export const AggregateWorkflowsByOriginRequestSchema = z
  .object({
    origin: z.string().min(1),
    originIds: z.array(z.string()).readonly(),
    statusIn: z.array(WorkflowStatusSchema).readonly().optional(),
  })
  .strict();
export type AggregateWorkflowsByOriginRequest = z.infer<
  typeof AggregateWorkflowsByOriginRequestSchema
>;
export const AggregateWorkflowsByOriginResponseSchema = z.record(z.string(), OriginAggregateSchema);
export type AggregateWorkflowsByOriginResponse = z.infer<
  typeof AggregateWorkflowsByOriginResponseSchema
>;
export type AggregateWorkflowsByOriginError = DatabaseUnavailable;
export interface AggregateWorkflowsByOriginDeps {
  readonly query: WorkflowQueries;
}
export class AggregateWorkflowsByOriginUseCase
  implements
    UseCase<
      AggregateWorkflowsByOriginRequest,
      AggregateWorkflowsByOriginResponse,
      AggregateWorkflowsByOriginError
    >
{
  constructor(private readonly deps: AggregateWorkflowsByOriginDeps) {}
  execute(
    request: AggregateWorkflowsByOriginRequest,
  ): UseCaseResult<AggregateWorkflowsByOriginResponse, AggregateWorkflowsByOriginError> {
    const parsed = AggregateWorkflowsByOriginRequestSchema.parse(request);
    if (parsed.originIds.length === 0) return this.deps.query.query(() => ({}));
    const q = this.deps.query;
    return q.query((db) => {
      const conditions: SQL[] = [
        eq(q.workflows.origin, parsed.origin),
        inArray(q.workflows.originId, [...parsed.originIds]),
      ];
      if (parsed.statusIn !== undefined && parsed.statusIn.length > 0)
        conditions.push(inArray(q.workflows.status, [...parsed.statusIn]));
      const rows = db
        .select({
          originId: q.workflows.originId,
          totalCount: count(),
          runningCount: sql<number>`sum(case when ${q.workflows.status} = 'running' then 1 else 0 end)`,
          awaitingCount: sql<number>`sum(case when ${q.workflows.status} = 'running' and exists (
            select 1 from workflow_nodes n
            where n.workflow_id = ${q.workflows.id}
              and n.kind = 'human'
              and n.status = 'running'
          ) then 1 else 0 end)`,
        })
        .from(q.workflows)
        .where(and(...conditions))
        .groupBy(q.workflows.originId)
        .all();
      const out: AggregateWorkflowsByOriginResponse = {};
      for (const row of rows) {
        if (row.originId === null) continue;
        out[row.originId] = {
          totalCount: Number(row.totalCount),
          runningCount: Number(row.runningCount ?? 0),
          awaitingCount: Number(row.awaitingCount ?? 0),
        };
      }
      for (const id of parsed.originIds)
        out[id] ??= { totalCount: 0, runningCount: 0, awaitingCount: 0 };
      return out;
    });
  }
}
