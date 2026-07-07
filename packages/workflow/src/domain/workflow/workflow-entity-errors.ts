import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";

/** A referenced node id has no row in the workflow. */
export type WorkflowNodeNotFound = {
  readonly type: "WorkflowNodeNotFound";
  readonly workflowId?: string;
  readonly nodeId: string;
};

export type EmptyParents = { readonly type: "EmptyParents" };

/**
 * A DAG mutation conflicts with the workflow's structural invariants
 * (coordinator chaining, frontier ownership, parent readiness, or the
 * single-coordinator-leaf rule). `reason.kind` names the specific conflict.
 */
export type WorkflowDagConflict = {
  readonly type: "WorkflowDagConflict";
  readonly reason:
    | {
        readonly kind: "successorCoordExists";
        readonly workflowId: string;
        readonly coordParentNodeId: string;
      }
    | { readonly kind: "orphanCoordInsert"; readonly workflowId: string }
    | {
        readonly kind: "parentState";
        readonly workflowId: string;
        readonly nodeKind: string;
        readonly parentNodeId: string;
        readonly parentStatus: string;
      }
    | {
        readonly kind: "invariant";
        readonly workflowId: string;
        readonly actualLeafIds: readonly string[];
        readonly actualLeafKinds: readonly WorkflowNodeKind[];
      };
};

/**
 * A submitted subgraph is structurally invalid (empty, malformed temp ids,
 * unresolved refs, cycles, parentless temps, or multiple coordinator temps).
 * `reason.kind` names the specific defect.
 */
export type WorkflowSubgraphInvalid = {
  readonly type: "WorkflowSubgraphInvalid";
  readonly reason:
    | { readonly kind: "empty" }
    | { readonly kind: "tempIdInvalid"; readonly message: string }
    | { readonly kind: "tempParentless"; readonly tempId: string }
    | {
        readonly kind: "nodeRefUnresolved";
        readonly workflowId: string;
        readonly refKind: "existing" | "temp";
        readonly refValue: string;
      }
    | {
        readonly kind: "cyclic";
        readonly workflowId: string;
        readonly from: string;
        readonly to: string;
      }
    | { readonly kind: "multipleCoordTemps"; readonly workflowId: string };
};

export type SubgraphError = WorkflowSubgraphInvalid;

export type WorkflowNodeNotMutable = {
  readonly type: "WorkflowNodeNotMutable";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly status: string;
  readonly verb: string;
};

/**
 * A `pruneSubgraph` request is rejected. `reason.kind` names the specific
 * violation: the first three are per-target input constraints checked up front
 * (before any mutation), the last two are remaining-graph invariants checked
 * against the simulated post-removal graph. All five reject before any write,
 * so a rejected prune leaves the aggregate untouched.
 */
export type WorkflowPruneRejected = {
  readonly type: "WorkflowPruneRejected";
  readonly reason:
    | { readonly kind: "nodeNotFound"; readonly workflowId: string; readonly nodeId: string }
    | {
        readonly kind: "nodeNotStarted";
        readonly workflowId: string;
        readonly nodeId: string;
        readonly status: string;
      }
    | { readonly kind: "rootCoordProtected"; readonly workflowId: string; readonly nodeId: string }
    | { readonly kind: "orphan"; readonly workflowId: string; readonly nodeId: string }
    | { readonly kind: "coordChainBroken"; readonly workflowId: string; readonly nodeId: string };
};

export function workflowNodeNotMutable(
  workflowId: string,
  nodeId: string,
  status: string,
  verb: string,
): WorkflowNodeNotMutable {
  return { type: "WorkflowNodeNotMutable", workflowId, nodeId, status, verb };
}

/**
 * A spec-patch body targets a node whose kind doesn't match the body's declared
 * kind (e.g. a `human` patch aimed at a `worker` node). `expected` is the kind
 * the caller asked to patch as; `actual` is the node's real kind. Rejected
 * before any merge/validate so the caller can't accidentally validate a spec
 * against the wrong runner.
 */
export type NodeKindMismatch = {
  readonly type: "NodeKindMismatch";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly expected: WorkflowNodeKind;
  readonly actual: WorkflowNodeKind;
};

/**
 * A spec patch targets a coordinator node. Coordinator specs are owned by the
 * engine's chaining/retry machinery, not by ad-hoc patches, so they are never
 * editable through this path regardless of the body's declared kind.
 */
export type CoordSpecNotEditable = {
  readonly type: "CoordSpecNotEditable";
  readonly workflowId: string;
  readonly nodeId: string;
};

/**
 * An optimistic-concurrency check failed: the `specVersion` the caller supplied
 * no longer matches the node's current `specVersion` (a concurrent patch landed
 * first). `expected` is the caller's stale version; `actual` is the node's
 * current one. Rejected before any write.
 */
export type SpecVersionConflict = {
  readonly type: "SpecVersionConflict";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly expected: number;
  readonly actual: number;
};
