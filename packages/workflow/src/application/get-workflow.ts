import { eq } from "drizzle-orm";
import { errAsync } from "neverthrow";
import { z } from "zod";
import {
  type WorkflowCancellation,
  WorkflowCancellationSchema,
} from "../domain/workflow/workflow-cancellation.js";
import type { WorkflowEntityCorruption } from "../domain/workflow/workflow-corruption.js";
import {
  type WorkflowFailure,
  WorkflowFailureSchema,
} from "../domain/workflow/workflow-failure.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowNotFound,
} from "../domain/workflow/workflow-repository.js";
import { type WorkflowStatus, WorkflowStatusSchema } from "../domain/workflow/workflow-status.js";
import {
  type WorkflowSuccess,
  WorkflowSuccessSchema,
} from "../domain/workflow/workflow-success.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { WorkflowRow } from "../infrastructure/drizzle/workflow-schema.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const WorkflowViewSchema = z.object({
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

export const GetWorkflowRequestSchema = z.object({ workflowId: WorkflowIdSchema }).strict();
export type GetWorkflowRequest = z.infer<typeof GetWorkflowRequestSchema>;
export const GetWorkflowResponseSchema = WorkflowViewSchema;
export type GetWorkflowResponse = z.infer<typeof GetWorkflowResponseSchema>;
export type GetWorkflowError = WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable;
export interface GetWorkflowDeps {
  readonly query: WorkflowQueries;
}
export class GetWorkflowUseCase
  implements UseCase<GetWorkflowRequest, GetWorkflowResponse, GetWorkflowError>
{
  constructor(private readonly deps: GetWorkflowDeps) {}
  execute(request: GetWorkflowRequest): UseCaseResult<GetWorkflowResponse, GetWorkflowError> {
    const { workflowId } = GetWorkflowRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query((db) => db.select().from(q.workflows).where(eq(q.workflows.id, workflowId)).get())
      .andThen((row) =>
        row === undefined
          ? errAsync({ type: "WorkflowNotFound" as const, workflowId })
          : q.query(() => toWorkflowView(row)),
      );
  }
}

function toWorkflowView(row: WorkflowRow): GetWorkflowResponse {
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

function coerceWorkflowStatus(raw: string): WorkflowStatus {
  const parsed = WorkflowStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "running";
}

function coerceWorkflowId(raw: string): GetWorkflowResponse["id"] {
  const parsed = WorkflowIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as GetWorkflowResponse["id"]);
}
