import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";

/** A referenced node id has no row in the workflow. */
export type WorkflowNodeNotFound = {
  readonly type: "WorkflowNodeNotFound";
  readonly workflowId?: string;
  readonly nodeId: string;
};

export type MultipleSuccessorCoords = {
  readonly type: "MultipleSuccessorCoords";
  readonly workflowId: string;
  readonly coordParentNodeId: string;
};

export type OrphanCoordInsert = {
  readonly type: "OrphanCoordInsert";
  readonly workflowId: string;
};

export type ParentState = {
  readonly type: "ParentState";
  readonly workflowId: string;
  readonly nodeKind: string;
  readonly parentNodeId: string;
  readonly parentStatus: string;
};

export type EmptyParents = { readonly type: "EmptyParents" };

export type DagInvariant = {
  readonly type: "DagInvariant";
  readonly workflowId: string;
  readonly actualLeafIds: readonly string[];
  readonly actualLeafKinds: readonly WorkflowNodeKind[];
};

export type WorkflowSubgraphEmpty = { readonly type: "WorkflowSubgraphEmpty" };

export type WorkflowSubgraphTempIdInvalid = {
  readonly type: "WorkflowSubgraphTempIdInvalid";
  readonly reason: string;
};

export type WorkflowSubgraphTempParentless = {
  readonly type: "WorkflowSubgraphTempParentless";
  readonly tempId: string;
};

export type WorkflowSubgraphNodeRefUnresolved = {
  readonly type: "WorkflowSubgraphNodeRefUnresolved";
  readonly workflowId: string;
  readonly refKind: "existing" | "temp";
  readonly refValue: string;
};

export type WorkflowSubgraphCyclic = {
  readonly type: "WorkflowSubgraphCyclic";
  readonly workflowId: string;
  readonly from: string;
  readonly to: string;
};

export type WorkflowSubgraphMultipleCoordTemps = {
  readonly type: "WorkflowSubgraphMultipleCoordTemps";
  readonly workflowId: string;
};

export type SubgraphError =
  | WorkflowSubgraphEmpty
  | WorkflowSubgraphTempIdInvalid
  | WorkflowSubgraphTempParentless
  | WorkflowSubgraphNodeRefUnresolved
  | WorkflowSubgraphCyclic
  | WorkflowSubgraphMultipleCoordTemps;

export type WorkflowNodeNotMutable = {
  readonly type: "WorkflowNodeNotMutable";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly status: string;
  readonly verb: string;
};

export function workflowNodeNotMutable(
  workflowId: string,
  nodeId: string,
  status: string,
  verb: string,
): WorkflowNodeNotMutable {
  return { type: "WorkflowNodeNotMutable", workflowId, nodeId, status, verb };
}
