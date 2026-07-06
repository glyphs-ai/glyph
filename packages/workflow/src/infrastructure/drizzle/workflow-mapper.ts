import { err, ok, type Result } from "neverthrow";
import { WorkflowEdgeEntity } from "../../domain/edge/workflow-edge-entity.js";
import { WorkflowNodeEntity } from "../../domain/node/workflow-node-entity.js";
import { WorkflowNodeIdSchema } from "../../domain/node/workflow-node-id.js";
import {
  WORKFLOW_NODE_KINDS,
  WorkflowNodeKindSchema,
} from "../../domain/node/workflow-node-kind.js";
import { WorkflowNodeStatusSchema } from "../../domain/node/workflow-node-status.js";
import { WorkflowBriefSchema } from "../../domain/workflow/workflow-brief.js";
import { WorkflowCancellationSchema } from "../../domain/workflow/workflow-cancellation.js";
import { WorkflowEntity } from "../../domain/workflow/workflow-entity.js";
import { WorkflowFailureSchema } from "../../domain/workflow/workflow-failure.js";
import { WorkflowIdSchema } from "../../domain/workflow/workflow-id.js";
import { WorkflowOriginSchema } from "../../domain/workflow/workflow-origin.js";
import type { WorkflowEntityCorruption } from "../../domain/workflow/workflow-repository.js";
import { WorkflowStatusSchema } from "../../domain/workflow/workflow-status.js";
import { WorkflowSuccessSchema } from "../../domain/workflow/workflow-success.js";
import type {
  NewWorkflowEdgeRow,
  NewWorkflowNodeRow,
  NewWorkflowRow,
  WorkflowEdgeRow,
  WorkflowNodeRow,
  WorkflowRow,
} from "./workflow-schema.js";

export const WorkflowMapper = {
  toWorkflowRow(entity: WorkflowEntity): NewWorkflowRow {
    return {
      id: entity.id,
      brief: entity.brief,
      details: entity.details ?? null,
      coordinatorAgent: entity.coordinatorAgent,
      status: entity.status,
      origin: entity.origin,
      originId: entity.originId ?? null,
      metadata: JSON.stringify(entity.metadata),
      createdAt: entity.createdAt,
      startedAt: entity.startedAt ?? null,
      endedAt: entity.endedAt ?? null,
      success: entity.success === undefined ? null : JSON.stringify(entity.success),
      failure: entity.failure === undefined ? null : JSON.stringify(entity.failure),
      cancellation: entity.cancellation === undefined ? null : JSON.stringify(entity.cancellation),
    };
  },
  toNodeRow(entity: WorkflowNodeEntity): NewWorkflowNodeRow {
    return {
      id: entity.id,
      workflowId: entity.workflowId,
      kind: entity.kind,
      specJson: JSON.stringify(entity.spec),
      phase: entity.phase,
      status: entity.status,
      metadata: JSON.stringify(entity.metadata),
      createdAt: entity.createdAt,
      readyAt: entity.readyAt ?? null,
      runningAt: entity.runningAt ?? null,
      endedAt: entity.endedAt ?? null,
    };
  },
  toEdgeRow(entity: WorkflowEdgeEntity): NewWorkflowEdgeRow {
    return { workflowId: entity.workflowId, fromNodeId: entity.from, toNodeId: entity.to };
  },
  toEntity(input: {
    readonly workflowRow: WorkflowRow;
    readonly nodeRows: readonly WorkflowNodeRow[];
    readonly edgeRows: readonly WorkflowEdgeRow[];
  }): Result<WorkflowEntity, WorkflowEntityCorruption> {
    const workflow = toWorkflowHeader(input.workflowRow);
    if (workflow.isErr()) return err(workflow.error);
    const nodes: WorkflowNodeEntity[] = [];
    for (const row of input.nodeRows) {
      const node = toNodeEntity(row);
      if (node.isErr()) return err(node.error);
      nodes.push(node.value);
    }
    const edges: WorkflowEdgeEntity[] = [];
    for (const row of input.edgeRows) {
      const edge = toEdgeEntity(row);
      if (edge.isErr()) return err(edge.error);
      edges.push(edge.value);
    }
    return ok(WorkflowEntity.reconstitute({ ...workflow.value, nodes, edges }));
  },
} as const;

function toWorkflowHeader(
  row: WorkflowRow,
): Result<
  Omit<Parameters<typeof WorkflowEntity.reconstitute>[0], "nodes" | "edges">,
  WorkflowEntityCorruption
> {
  const id = WorkflowIdSchema.safeParse(row.id);
  if (!id.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "id",
      value: String(row.id),
      allowed: ["valid workflow id"],
    });
  const status = WorkflowStatusSchema.safeParse(row.status);
  if (!status.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "enumValue",
      field: "status",
      value: String(row.status),
      allowed: WorkflowStatusSchema.options,
    });
  const origin = WorkflowOriginSchema.safeParse(row.origin);
  if (!origin.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "origin",
      value: String(row.origin),
      allowed: ["non-empty string"],
    });
  const brief = WorkflowBriefSchema.safeParse(row.brief);
  if (!brief.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "brief",
      value: String(row.brief),
      allowed: ["non-empty single-line string (≤ 200 characters)"],
    });
  const metadata = parseJsonObject("metadata", row.metadata);
  if (metadata.isErr()) return err(metadata.error);
  const success = parseJsonSchemaColumn("success", row.success, WorkflowSuccessSchema);
  if (success.isErr()) return err(success.error);
  const failure = parseJsonSchemaColumn("failure", row.failure, WorkflowFailureSchema);
  if (failure.isErr()) return err(failure.error);
  const cancellation = parseJsonSchemaColumn(
    "cancellation",
    row.cancellation,
    WorkflowCancellationSchema,
  );
  if (cancellation.isErr()) return err(cancellation.error);
  const terminal = validateTerminalInvariant(
    status.data,
    success.value,
    failure.value,
    cancellation.value,
  );
  if (terminal !== undefined) return err(terminal);
  return ok({
    id: id.data,
    brief: brief.data,
    details: row.details ?? undefined,
    coordinatorAgent: row.coordinatorAgent,
    status: status.data,
    origin: origin.data,
    originId: row.originId ?? undefined,
    metadata: metadata.value,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
    success: success.value,
    failure: failure.value,
    cancellation: cancellation.value,
  });
}

function toNodeEntity(row: WorkflowNodeRow): Result<WorkflowNodeEntity, WorkflowEntityCorruption> {
  const id = WorkflowNodeIdSchema.safeParse(row.id);
  if (!id.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "id",
      value: String(row.id),
      allowed: ["valid workflow node id"],
    });
  const workflowId = WorkflowIdSchema.safeParse(row.workflowId);
  if (!workflowId.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "workflowId",
      value: String(row.workflowId),
      allowed: ["valid workflow id"],
    });
  const kind = WorkflowNodeKindSchema.safeParse(row.kind);
  if (!kind.success)
    return err(
      typeof row.kind === "string" && row.kind.length > 0
        ? {
            type: "WorkflowInvariantViolation",
            subtype: "nodeKindValue",
            value: row.kind,
            allowed: WORKFLOW_NODE_KINDS,
          }
        : { type: "WorkflowInvariantViolation", subtype: "nodeKindShape", value: row.kind },
    );
  const status = WorkflowNodeStatusSchema.safeParse(row.status);
  if (!status.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "enumValue",
      field: "status",
      value: String(row.status),
      allowed: WorkflowNodeStatusSchema.options,
    });
  const spec = parseJsonColumn<unknown>("specJson", row.specJson);
  if (spec.isErr()) return err(spec.error);
  const metadata = parseJsonObject("metadata", row.metadata);
  if (metadata.isErr()) return err(metadata.error);
  return ok(
    WorkflowNodeEntity.reconstitute({
      id: id.data,
      workflowId: workflowId.data,
      kind: kind.data,
      spec: spec.value,
      phase: row.phase,
      status: status.data,
      metadata: metadata.value,
      createdAt: row.createdAt,
      readyAt: row.readyAt ?? undefined,
      runningAt: row.runningAt ?? undefined,
      endedAt: row.endedAt ?? undefined,
    }),
  );
}

function toEdgeEntity(row: WorkflowEdgeRow): Result<WorkflowEdgeEntity, WorkflowEntityCorruption> {
  const workflowId = WorkflowIdSchema.safeParse(row.workflowId);
  if (!workflowId.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "workflowId",
      value: String(row.workflowId),
      allowed: ["valid workflow id"],
    });
  const from = WorkflowNodeIdSchema.safeParse(row.fromNodeId);
  if (!from.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "fromNodeId",
      value: String(row.fromNodeId),
      allowed: ["valid workflow node id"],
    });
  const to = WorkflowNodeIdSchema.safeParse(row.toNodeId);
  if (!to.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: "toNodeId",
      value: String(row.toNodeId),
      allowed: ["valid workflow node id"],
    });
  return ok(
    WorkflowEdgeEntity.reconstitute({ workflowId: workflowId.data, from: from.data, to: to.data }),
  );
}

function validateTerminalInvariant(
  status: string,
  success: unknown,
  failure: unknown,
  cancellation: unknown,
): WorkflowEntityCorruption | undefined {
  if (
    status === "succeeded" &&
    success !== undefined &&
    failure === undefined &&
    cancellation === undefined
  )
    return undefined;
  if (
    status === "failed" &&
    failure !== undefined &&
    success === undefined &&
    cancellation === undefined
  )
    return undefined;
  if (
    status === "cancelled" &&
    cancellation !== undefined &&
    success === undefined &&
    failure === undefined
  )
    return undefined;
  if (
    status === "running" &&
    success === undefined &&
    failure === undefined &&
    cancellation === undefined
  )
    return undefined;
  return {
    type: "WorkflowInvariantViolation",
    subtype: "corruption",
    field: "terminalPayload",
    value: String(status),
    allowed: ["exactly the matching terminal payload"],
  };
}
function parseJsonObject(
  name: string,
  raw: string,
): Result<Record<string, unknown>, WorkflowEntityCorruption> {
  const parsed = parseJsonColumn<unknown>(name, raw);
  if (parsed.isErr()) return err(parsed.error);
  if (parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value))
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: name,
      value: String(raw),
      allowed: ["JSON object"],
    });
  return ok(parsed.value as Record<string, unknown>);
}
function parseJsonColumn<T>(
  name: string,
  raw: string | null,
): Result<T | undefined, WorkflowEntityCorruption> {
  if (raw === null) return ok(undefined);
  try {
    return ok(JSON.parse(raw) as T);
  } catch {
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: name,
      value: String(raw),
      allowed: ["valid JSON"],
    });
  }
}

function parseJsonSchemaColumn<T>(
  name: string,
  raw: string | null,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Result<T | undefined, WorkflowEntityCorruption> {
  if (raw === null) return ok(undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: name,
      value: String(raw),
      allowed: ["valid JSON"],
    });
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    return err({
      type: "WorkflowInvariantViolation",
      subtype: "corruption",
      field: name,
      value: String(raw),
      allowed: [`valid ${name} payload`],
    });
  return ok(result.data);
}
