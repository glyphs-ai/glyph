import { and, desc, eq, gte, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type WorkflowCancellation,
  WorkflowCancellationSchema,
} from "../domain/workflow/workflow-cancellation.js";
import {
  type WorkflowFailure,
  WorkflowFailureSchema,
} from "../domain/workflow/workflow-failure.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type { DatabaseUnavailable } from "../domain/workflow/workflow-repository.js";
import { type WorkflowStatus, WorkflowStatusSchema } from "../domain/workflow/workflow-status.js";
import {
  type WorkflowSuccess,
  WorkflowSuccessSchema,
} from "../domain/workflow/workflow-success.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { WorkflowRow } from "../infrastructure/drizzle/workflow-schema.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

const WorkflowViewSchema = z.object({
  id: WorkflowIdSchema,
  brief: z.string(),
  details: z.string().optional(),
  coordinatorAgent: z.string(),
  status: WorkflowStatusSchema,
  origin: z.string(),
  originId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  success: WorkflowSuccessSchema.optional(),
  failure: WorkflowFailureSchema.optional(),
  cancellation: WorkflowCancellationSchema.optional(),
});

export const ListWorkflowsRequestSchema = z
  .object({
    coordinatorAgent: z.string().optional(),
    createdSince: z.string().optional(),
    idLike: z.string().optional(),
    origin: z.union([z.string(), z.array(z.string()).readonly()]).optional(),
    originId: z.string().optional(),
  })
  .strict()
  .default({});
export type ListWorkflowsRequest = z.infer<typeof ListWorkflowsRequestSchema>;
export const ListWorkflowsResponseSchema = z.array(WorkflowViewSchema).readonly();
export type ListWorkflowsResponse = z.infer<typeof ListWorkflowsResponseSchema>;
export type ListWorkflowsError = DatabaseUnavailable;
export interface ListWorkflowsDeps {
  readonly query: WorkflowQueries;
}
export class ListWorkflowsUseCase
  implements UseCase<ListWorkflowsRequest | undefined, ListWorkflowsResponse, ListWorkflowsError>
{
  constructor(private readonly deps: ListWorkflowsDeps) {}
  execute(
    request: ListWorkflowsRequest | undefined = {},
  ): UseCaseResult<ListWorkflowsResponse, ListWorkflowsError> {
    const parsed = ListWorkflowsRequestSchema.parse(request);
    const q = this.deps.query;
    return q.query((db) => {
      const conditions: SQL[] = [];
      if (parsed.coordinatorAgent !== undefined)
        conditions.push(eq(q.workflows.coordinatorAgent, parsed.coordinatorAgent));
      if (parsed.createdSince !== undefined)
        conditions.push(gte(q.workflows.createdAt, parsed.createdSince));
      if (parsed.idLike !== undefined) {
        // Escape LIKE metacharacters so a literal id fragment from the search
        // box doesn't accidentally widen the match (e.g. a typed `%`).
        const pattern = `%${escapeLike(parsed.idLike)}%`;
        conditions.push(sql`${q.workflows.id} LIKE ${pattern} ESCAPE '\\'`);
      }
      if (parsed.origin !== undefined) {
        const origins = Array.isArray(parsed.origin) ? parsed.origin : [parsed.origin];
        if (origins.length === 1) conditions.push(eq(q.workflows.origin, origins[0] as string));
        else if (origins.length > 1) conditions.push(inArray(q.workflows.origin, origins));
      }
      if (parsed.originId !== undefined) conditions.push(eq(q.workflows.originId, parsed.originId));
      const where = conditions.length === 0 ? undefined : and(...conditions);
      const rows =
        where === undefined
          ? db.select().from(q.workflows).orderBy(desc(q.workflows.createdAt)).all()
          : db.select().from(q.workflows).where(where).orderBy(desc(q.workflows.createdAt)).all();
      return rows.map(toWorkflowView);
    });
  }
}

function toWorkflowView(row: WorkflowRow): ListWorkflowsResponse[number] {
  return {
    id: coerceWorkflowId(row.id),
    brief: row.brief,
    ...(row.details !== null ? { details: row.details } : {}),
    coordinatorAgent: row.coordinatorAgent,
    status: coerceWorkflowStatus(row.status),
    origin: row.origin,
    ...(row.originId !== null ? { originId: row.originId } : {}),
    metadata: parseJsonObject(row.metadata),
    createdAt: row.createdAt,
    ...(row.startedAt !== null ? { startedAt: row.startedAt } : {}),
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
    ...(row.success !== null ? { success: parseJsonValue<WorkflowSuccess>(row.success) } : {}),
    ...(row.failure !== null ? { failure: parseJsonValue<WorkflowFailure>(row.failure) } : {}),
    ...(row.cancellation !== null
      ? { cancellation: parseJsonValue<WorkflowCancellation>(row.cancellation) }
      : {}),
  };
}

function parseJsonValue<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJsonValue<unknown>(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}

function coerceWorkflowId(raw: string): ListWorkflowsResponse[number]["id"] {
  const parsed = WorkflowIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as ListWorkflowsResponse[number]["id"]);
}

function coerceWorkflowStatus(raw: string): WorkflowStatus {
  const parsed = WorkflowStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "running";
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}
