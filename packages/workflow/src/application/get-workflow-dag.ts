import { asc, eq } from "drizzle-orm";
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
import {
  type WorkflowCancellation,
  WorkflowCancellationSchema,
} from "../domain/workflow/workflow-cancellation.js";
import {
  type WorkflowFailure,
  WorkflowFailureSchema,
} from "../domain/workflow/workflow-failure.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
} from "../domain/workflow/workflow-repository.js";
import { type WorkflowStatus, WorkflowStatusSchema } from "../domain/workflow/workflow-status.js";
import {
  type WorkflowSuccess,
  WorkflowSuccessSchema,
} from "../domain/workflow/workflow-success.js";
import type { WorkflowQueries } from "../infrastructure/drizzle/workflow-queries.js";
import type {
  WorkflowEdgeRow,
  WorkflowNodeRow,
  WorkflowRow,
} from "../infrastructure/drizzle/workflow-schema.js";
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
const WorkflowNodeViewSchema = z.object({
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
export const WorkflowEdgeViewSchema = z.object({
  workflowId: WorkflowIdSchema,
  from: WorkflowNodeIdSchema,
  to: WorkflowNodeIdSchema,
});
export type WorkflowEdgeView = z.infer<typeof WorkflowEdgeViewSchema>;
export const WorkflowDagSnapshotSchema = z.object({
  workflow: WorkflowViewSchema,
  nodes: z.array(WorkflowNodeViewSchema).readonly(),
  edges: z.array(WorkflowEdgeViewSchema).readonly(),
});
export type WorkflowDagSnapshot = z.infer<typeof WorkflowDagSnapshotSchema>;

export const GetWorkflowDagRequestSchema = z.object({ workflowId: WorkflowIdSchema }).strict();
export type GetWorkflowDagRequest = z.infer<typeof GetWorkflowDagRequestSchema>;
export const GetWorkflowDagResponseSchema = WorkflowDagSnapshotSchema;
export type GetWorkflowDagResponse = z.infer<typeof GetWorkflowDagResponseSchema>;
export type GetWorkflowDagError = WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable;
export interface GetWorkflowDagDeps {
  readonly query: WorkflowQueries;
}
export class GetWorkflowDagUseCase
  implements UseCase<GetWorkflowDagRequest, GetWorkflowDagResponse, GetWorkflowDagError>
{
  constructor(private readonly deps: GetWorkflowDagDeps) {}
  execute(
    request: GetWorkflowDagRequest,
  ): UseCaseResult<GetWorkflowDagResponse, GetWorkflowDagError> {
    const { workflowId } = GetWorkflowDagRequestSchema.parse(request);
    const q = this.deps.query;
    return q
      .query((db) => {
        const workflow = db.select().from(q.workflows).where(eq(q.workflows.id, workflowId)).get();
        if (workflow === undefined) return null;
        const nodes = db
          .select()
          .from(q.workflowNodes)
          .where(eq(q.workflowNodes.workflowId, workflowId))
          .orderBy(
            asc(q.workflowNodes.phase),
            asc(q.workflowNodes.createdAt),
            asc(q.workflowNodes.id),
          )
          .all();
        const edges = db
          .select()
          .from(q.workflowEdges)
          .where(eq(q.workflowEdges.workflowId, workflowId))
          .orderBy(asc(q.workflowEdges.fromNodeId), asc(q.workflowEdges.toNodeId))
          .all();
        return {
          workflow: toWorkflowView(workflow),
          nodes: nodes.map(toWorkflowNodeView),
          edges: edges.map(toWorkflowEdgeView),
        };
      })
      .andThen((snapshot) =>
        snapshot === null
          ? errAsync({ type: "WorkflowNotFound" as const, workflowId })
          : q.query(() => snapshot),
      );
  }
}

function toWorkflowView(row: WorkflowRow): z.infer<typeof WorkflowViewSchema> {
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

function toWorkflowNodeView(row: WorkflowNodeRow): z.infer<typeof WorkflowNodeViewSchema> {
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

function toWorkflowEdgeView(row: WorkflowEdgeRow): z.infer<typeof WorkflowEdgeViewSchema> {
  return {
    workflowId: coerceWorkflowId(row.workflowId),
    from: coerceWorkflowNodeId(row.fromNodeId),
    to: coerceWorkflowNodeId(row.toNodeId),
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

function coerceWorkflowId(raw: string): z.infer<typeof WorkflowIdSchema> {
  const parsed = WorkflowIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as z.infer<typeof WorkflowIdSchema>);
}

function coerceWorkflowNodeId(raw: string): z.infer<typeof WorkflowNodeIdSchema> {
  const parsed = WorkflowNodeIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as z.infer<typeof WorkflowNodeIdSchema>);
}

function coerceWorkflowStatus(raw: string): WorkflowStatus {
  const parsed = WorkflowStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "running";
}

function coerceNodeStatus(raw: string): WorkflowNodeStatus {
  const parsed = WorkflowNodeStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : "not_started";
}

function coerceNodeKind(raw: string): WorkflowNodeKind {
  const parsed = WorkflowNodeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : "worker";
}
