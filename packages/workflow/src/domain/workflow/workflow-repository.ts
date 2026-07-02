import type { ResultAsync } from "neverthrow";
import type { WorkflowId } from "../workflow/workflow-id.js";
import type { WorkflowEntityCorruption } from "./workflow-corruption.js";
import type { WorkflowEntity } from "./workflow-entity.js";

/** Persistence fault atom for repository IO failures (the SQLite driver threw). */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

/** Business outcome for a missing workflow row. */
export type WorkflowNotFound = {
  readonly type: "WorkflowNotFound";
  readonly workflowId: string;
};

/** Business outcome for a missing workflow-node row. */
export type WorkflowNodeNotFound = {
  readonly type: "WorkflowNodeNotFound";
  readonly workflowId?: string;
  readonly nodeId: string;
};

/** Business outcome for a missing DAG edge. */
export type WorkflowEdgeNotFound = {
  readonly type: "WorkflowEdgeNotFound";
  readonly workflowId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
};

/** CQRS write-side repository for the mutable workflow aggregate. */
export interface WorkflowRepository {
  insert(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable>;
  get(
    id: WorkflowId,
  ): ResultAsync<WorkflowEntity, WorkflowNotFound | WorkflowEntityCorruption | DatabaseUnavailable>;
  save(entity: WorkflowEntity): ResultAsync<void, DatabaseUnavailable>;
}

export type WorkflowTx = never;
export type OriginAggregate = never;
export type ListWorkflowsFilter = never;
export type WorkflowStatusUpdate = never;
export type WorkflowNodeLifecyclePatch = never;
