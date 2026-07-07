import { eq } from "drizzle-orm";
import { errAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import {
  type WorkflowNodeKind,
  WorkflowNodeKindSchema,
} from "../domain/node/workflow-node-kind.js";
import {
  type WorkflowNodeStatus,
  WorkflowNodeStatusSchema,
} from "../domain/node/workflow-node-status.js";
import type { WorkflowNodeNotFound } from "../domain/workflow/workflow-entity-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type { WorkflowNodeRow } from "../infrastructure/drizzle/workflow-schema.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetWorkflowNodeRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, nodeId: WorkflowNodeIdSchema })
  .strict();
export type GetWorkflowNodeRequest = z.infer<typeof GetWorkflowNodeRequestSchema>;
export const GetWorkflowNodeResponseSchema = z.object({
  id: WorkflowNodeIdSchema,
  workflowId: WorkflowIdSchema,
  kind: WorkflowNodeKindSchema,
  spec: z.unknown(),
  phase: z.number(),
  status: WorkflowNodeStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readyAt: z.string().optional(),
  runningAt: z.string().optional(),
  endedAt: z.string().optional(),
});
export type GetWorkflowNodeResponse = z.infer<typeof GetWorkflowNodeResponseSchema>;
export type GetWorkflowNodeError =
  | WorkflowNodeNotFound
  | WorkflowEntityCorruption
  | DatabaseUnavailable;
export interface GetWorkflowNodeDeps {
  readonly query: WorkflowQueries;
}
export class GetWorkflowNodeUseCase
  implements UseCase<GetWorkflowNodeRequest, GetWorkflowNodeResponse, GetWorkflowNodeError>
{
  constructor(private readonly deps: GetWorkflowNodeDeps) {}
  execute(
    request: GetWorkflowNodeRequest,
  ): UseCaseResult<GetWorkflowNodeResponse, GetWorkflowNodeError> {
    const { workflowId, nodeId } = GetWorkflowNodeRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query(
        async (db) =>
          await db.select().from(q.workflowNodes).where(eq(q.workflowNodes.id, nodeId)).get(),
      )
      .andThen((row) =>
        row === undefined || row.workflowId !== workflowId
          ? errAsync({ type: "WorkflowNodeNotFound" as const, workflowId, nodeId })
          : q.query(async () => toGetWorkflowNodeResponse(row)),
      );
  }
}

function toGetWorkflowNodeResponse(row: WorkflowNodeRow): GetWorkflowNodeResponse {
  return {
    id: coerceWorkflowNodeId(row.id),
    workflowId: coerceWorkflowId(row.workflowId),
    kind: coerceNodeKind(row.kind),
    spec: parseJsonValue<unknown>(row.specJson),
    phase: row.phase,
    status: coerceNodeStatus(row.status),
    metadata: parseJsonObject(row.metadata),
    createdAt: row.createdAt,
    ...(row.readyAt !== null ? { readyAt: row.readyAt } : {}),
    ...(row.runningAt !== null ? { runningAt: row.runningAt } : {}),
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
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

function coerceWorkflowId(raw: string): GetWorkflowNodeResponse["workflowId"] {
  const parsed = WorkflowIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as GetWorkflowNodeResponse["workflowId"]);
}

function coerceWorkflowNodeId(raw: string): GetWorkflowNodeResponse["id"] {
  const parsed = WorkflowNodeIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as GetWorkflowNodeResponse["id"]);
}

function coerceNodeStatus(raw: string): WorkflowNodeStatus {
  const parsed = WorkflowNodeStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "not_started";
}

function coerceNodeKind(raw: string): WorkflowNodeKind {
  const parsed = WorkflowNodeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : "worker";
}
