import type { WorkflowNodeId } from "../node/workflow-node-id.js";
import type { WorkflowNodeKind } from "../node/workflow-node-kind.js";
import type { WorkflowNodeStatus } from "../node/workflow-node-status.js";
import type { WorkflowId } from "../workflow/workflow-id.js";

/**
 * Args accepted by {@link WorkflowNodeEntity.create}. Ids are branded upstream
 * and `spec` is runner-validated, so construction cannot fail.
 */
export interface WorkflowNodeCreateArgs {
  readonly id: WorkflowNodeId;
  readonly workflowId: WorkflowId;
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly phase: number;
  readonly status: WorkflowNodeStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly specVersion?: number;
}

/** Mapper-only trusted assembly from already validated, decoded row values. */
export interface WorkflowNodeReconstituteArgs extends WorkflowNodeCreateArgs {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly readyAt: string | undefined;
  readonly runningAt: string | undefined;
  readonly endedAt: string | undefined;
  readonly specVersion: number;
}

/** Persisted workflow-node child entity. */
export class WorkflowNodeEntity {
  private constructor(
    private readonly _id: WorkflowNodeId,
    private readonly _workflowId: WorkflowId,
    private readonly _kind: WorkflowNodeKind,
    private readonly _spec: unknown,
    private readonly _phase: number,
    private readonly _status: WorkflowNodeStatus,
    private readonly _metadata: Readonly<Record<string, unknown>>,
    private readonly _createdAt: string,
    private readonly _readyAt: string | undefined,
    private readonly _runningAt: string | undefined,
    private readonly _endedAt: string | undefined,
    private readonly _specVersion: number,
  ) {}

  static create(args: WorkflowNodeCreateArgs): WorkflowNodeEntity {
    return new WorkflowNodeEntity(
      args.id,
      args.workflowId,
      args.kind,
      args.spec,
      args.phase,
      args.status,
      Object.freeze({ ...(args.metadata ?? {}) }),
      args.createdAt,
      undefined,
      undefined,
      undefined,
      args.specVersion ?? 0,
    );
  }

  static reconstitute(args: WorkflowNodeReconstituteArgs): WorkflowNodeEntity {
    return new WorkflowNodeEntity(
      args.id,
      args.workflowId,
      args.kind,
      args.spec,
      args.phase,
      args.status,
      Object.freeze({ ...args.metadata }),
      args.createdAt,
      args.readyAt,
      args.runningAt,
      args.endedAt,
      args.specVersion,
    );
  }

  withPatch(
    patch: Partial<{
      readonly spec: unknown;
      readonly phase: number;
      readonly status: WorkflowNodeStatus;
      readonly metadata: Readonly<Record<string, unknown>>;
      readonly readyAt: string | undefined;
      readonly runningAt: string | undefined;
      readonly endedAt: string | undefined;
      readonly specVersion: number;
    }>,
  ): WorkflowNodeEntity {
    return new WorkflowNodeEntity(
      this.id,
      this.workflowId,
      this.kind,
      Object.hasOwn(patch, "spec") ? patch.spec : this.spec,
      patch.phase ?? this.phase,
      patch.status ?? this.status,
      Object.freeze({ ...(patch.metadata ?? this.metadata) }),
      this.createdAt,
      Object.hasOwn(patch, "readyAt") ? patch.readyAt : this.readyAt,
      Object.hasOwn(patch, "runningAt") ? patch.runningAt : this.runningAt,
      Object.hasOwn(patch, "endedAt") ? patch.endedAt : this.endedAt,
      patch.specVersion ?? this.specVersion,
    );
  }

  /**
   * Replace the node's spec with a runner-validated `spec`, bumping
   * {@link specVersion} by one. The version bump is what a later optimistic-
   * concurrency check compares against, so spec and version always move
   * together — callers cannot change one without the other.
   */
  withPatchedSpec(spec: unknown): WorkflowNodeEntity {
    return this.withPatch({ spec, specVersion: this._specVersion + 1 });
  }

  get id(): WorkflowNodeId {
    return this._id;
  }

  get workflowId(): WorkflowId {
    return this._workflowId;
  }

  get kind(): WorkflowNodeKind {
    return this._kind;
  }

  get spec(): unknown {
    return this._spec;
  }

  get phase(): number {
    return this._phase;
  }

  get status(): WorkflowNodeStatus {
    return this._status;
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get readyAt(): string | undefined {
    return this._readyAt;
  }

  get runningAt(): string | undefined {
    return this._runningAt;
  }

  get endedAt(): string | undefined {
    return this._endedAt;
  }

  get specVersion(): number {
    return this._specVersion;
  }
}
