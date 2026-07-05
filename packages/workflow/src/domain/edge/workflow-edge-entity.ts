import type { WorkflowNodeId } from "../node/workflow-node-id.js";
import type { WorkflowId } from "../workflow/workflow-id.js";

export interface WorkflowEdgeCreateArgs {
  readonly workflowId: WorkflowId;
  readonly from: WorkflowNodeId;
  readonly to: WorkflowNodeId;
}

/** Immutable value object for one workflow DAG edge. */
export class WorkflowEdgeEntity {
  private constructor(
    private readonly _workflowId: WorkflowId,
    private readonly _from: WorkflowNodeId,
    private readonly _to: WorkflowNodeId,
  ) {}

  static create(args: WorkflowEdgeCreateArgs): WorkflowEdgeEntity {
    return new WorkflowEdgeEntity(args.workflowId, args.from, args.to);
  }

  static reconstitute(args: WorkflowEdgeCreateArgs): WorkflowEdgeEntity {
    return new WorkflowEdgeEntity(args.workflowId, args.from, args.to);
  }

  get workflowId(): WorkflowId {
    return this._workflowId;
  }

  get from(): WorkflowNodeId {
    return this._from;
  }

  get to(): WorkflowNodeId {
    return this._to;
  }
}
