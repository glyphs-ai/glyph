import { err, ok, type Result } from "neverthrow";
import type { TaskCancellation } from "./task-cancellation.js";
import type { TaskFailure } from "./task-failure.js";
import { type InvalidTaskId, type TaskId, TaskIdSchema } from "./task-id.js";
import type { TaskOrigin } from "./task-origin.js";
import type { TaskStatus } from "./task-status.js";
import type { TaskSuccess } from "./task-success.js";

/** A state-transition method was called against an illegal source status. */
export type InvalidTransition = {
  readonly type: "InvalidTransition";
  readonly from: TaskStatus;
  readonly eventType: string;
};

/**
 * A persisted row failed reconstruction — its shape or a cross-field
 * invariant is incompatible with the current build (corruption or an
 * out-of-band edit). `id` is the row's primary key; `reason` names the
 * specific violation.
 */
export type CorruptedTask = {
  readonly type: "CorruptedTask";
  readonly id: string;
  readonly reason: string;
};

const VALID_STATUSES = new Set<TaskStatus>(["running", "succeeded", "failed", "cancelled"]);
const FAILURE_KINDS = new Set(["execution", "internal", "cascade"]);
const CANCELLATION_KINDS = new Set(["user", "cascade"]);

/** Args accepted by {@link TaskEntity.create}. The id is minted upstream. */
export interface TaskCreateArgs {
  readonly id: TaskId;
  readonly agent: string;
  readonly brief: string;
  readonly details?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Defaults to `"standalone"`. */
  readonly origin?: TaskOrigin;
  /** Routing id for a cross-package origin; omit for standalone. */
  readonly originId?: string;
  /** ISO-8601 UTC timestamp seeding `createdAt` (and `startedAt`). */
  readonly createdAt: string;
}

/**
 * Args accepted by {@link TaskEntity.fromStored}. Mirrors the public field
 * layout; the SQL row shape is a private detail of the repository.
 */
export interface TaskFromStoredArgs {
  readonly id: string;
  readonly agent: string;
  readonly brief: string;
  readonly details?: string;
  readonly origin: TaskOrigin;
  readonly originId?: string;
  readonly status: TaskStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly success?: TaskSuccess;
  readonly failure?: TaskFailure;
  readonly cancellation?: TaskCancellation;
}

/** Common opts accepted by every state-transition method. */
export interface TaskTransitionOpts {
  /** Metadata patch to shallow-merge (last-wins) into the existing bag. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** ISO-8601 UTC timestamp to record on `endedAt`. */
  readonly now?: string;
}

/**
 * Rich domain entity for a single autonomous task. Identity = `id`,
 * immutable; `agent` / `brief` / `details` / `origin` / `createdAt` /
 * `startedAt` are immutable for the task's lifetime. The task layer never
 * interprets `metadata` — it's an open-shape bag for runtime bookkeeping,
 * exposed whole via the `metadata` getter and per-key via the generic
 * `metadataString` reader, but no key's meaning is known here.
 *
 * Construction:
 *  - {@link TaskEntity.create}     — for new tasks; status starts at
 *    `running` (there is no intermediate non-terminal state).
 *  - {@link TaskEntity.fromStored} — rehydrates a row; returns
 *    `CorruptedTask` (or `InvalidTaskId`) instead of an entity on bad data.
 *
 * State machine: `running → {succeeded | failed | cancelled}`; terminal
 * statuses accept no further transitions. Each transition method returns
 * `InvalidTransition` when called against an illegal source status.
 * Transitions are immutable — they return a fresh entity.
 */
export class TaskEntity {
  private constructor(
    private readonly _id: TaskId,
    private readonly _agent: string,
    private readonly _brief: string,
    private readonly _details: string | undefined,
    private readonly _origin: TaskOrigin,
    private readonly _originId: string | undefined,
    private readonly _status: TaskStatus,
    private readonly _metadata: Readonly<Record<string, unknown>>,
    private readonly _createdAt: string,
    private readonly _startedAt: string,
    private readonly _endedAt: string | undefined,
    private readonly _success: TaskSuccess | undefined,
    private readonly _failure: TaskFailure | undefined,
    private readonly _cancellation: TaskCancellation | undefined,
  ) {}

  /**
   * Construct a fresh task in `running` status. `startedAt` is set to
   * `createdAt` — there is no intermediate non-terminal state between
   * dispatch and the subprocess starting. The id is minted upstream
   * (validated branded {@link TaskId}); the brief is validated by the
   * dispatch request schema, so this factory cannot fail.
   */
  static create(args: TaskCreateArgs): TaskEntity {
    return new TaskEntity(
      args.id,
      args.agent,
      args.brief,
      args.details,
      args.origin ?? "standalone",
      args.originId,
      "running",
      Object.freeze({ ...(args.metadata ?? {}) }),
      args.createdAt,
      args.createdAt,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  }

  /**
   * Reconstruct a task from a storage-side row. Validates every field — id
   * format, status enum, payload shapes, and the cross-field invariant
   * that each terminal status carries its own payload (and only its own).
   * Returns `InvalidTaskId` (id syntax) or `CorruptedTask` (anything else)
   * instead of an entity on bad data.
   */
  static fromStored(args: TaskFromStoredArgs): Result<TaskEntity, InvalidTaskId | CorruptedTask> {
    const parsedId = TaskIdSchema.safeParse(args.id);
    if (!parsedId.success) {
      return err({ type: "InvalidTaskId", id: args.id });
    }
    const id = parsedId.data;
    const corrupt = (reason: string): Result<TaskEntity, CorruptedTask> =>
      err({ type: "CorruptedTask", id: args.id, reason });

    if (typeof args.agent !== "string") return corrupt("task.agent must be a string");
    if (typeof args.brief !== "string" || args.brief.length === 0) {
      return corrupt("task.brief must be a non-empty string");
    }
    if (args.details !== undefined && typeof args.details !== "string") {
      return corrupt("task.details, when present, must be a string");
    }
    if (typeof args.origin !== "string" || args.origin.length === 0) {
      return corrupt("task.origin must be a non-empty string");
    }
    if (args.originId !== undefined && typeof args.originId !== "string") {
      return corrupt("task.origin_id, when present, must be a string");
    }
    if (typeof args.status !== "string" || !VALID_STATUSES.has(args.status)) {
      return corrupt(`task.status must be one of: ${[...VALID_STATUSES].join(", ")}`);
    }
    if (typeof args.createdAt !== "string") return corrupt("task.created_at must be a string");
    if (typeof args.startedAt !== "string" || args.startedAt.length === 0) {
      return corrupt("task.started_at must be a non-empty string");
    }
    if (
      args.metadata === null ||
      typeof args.metadata !== "object" ||
      Array.isArray(args.metadata)
    ) {
      return corrupt("task.metadata must be an object");
    }
    if (args.success !== undefined) {
      const reason = taskSuccessViolation(args.success);
      if (reason !== null) return corrupt(reason);
    }
    if (args.failure !== undefined) {
      const reason = taskFailureViolation(args.failure);
      if (reason !== null) return corrupt(reason);
    }
    if (args.cancellation !== undefined) {
      const reason = taskCancellationViolation(args.cancellation);
      if (reason !== null) return corrupt(reason);
    }
    // Cross-field invariants: every terminal status carries its own payload
    // (and only its own); non-terminal statuses carry none.
    if (args.status === "succeeded" && args.success === undefined) {
      return corrupt("task.success is required when status is 'succeeded'");
    }
    if (args.status === "failed" && args.failure === undefined) {
      return corrupt("task.failure is required when status is 'failed'");
    }
    if (args.status === "cancelled" && args.cancellation === undefined) {
      return corrupt("task.cancellation is required when status is 'cancelled'");
    }
    if (args.status !== "succeeded" && args.success !== undefined) {
      return corrupt("task.success is only allowed when status is 'succeeded'");
    }
    if (args.status !== "failed" && args.failure !== undefined) {
      return corrupt("task.failure is only allowed when status is 'failed'");
    }
    if (args.status !== "cancelled" && args.cancellation !== undefined) {
      return corrupt("task.cancellation is only allowed when status is 'cancelled'");
    }
    return ok(
      new TaskEntity(
        id,
        args.agent,
        args.brief,
        args.details,
        args.origin,
        args.originId,
        args.status,
        Object.freeze({ ...args.metadata }),
        args.createdAt,
        args.startedAt,
        args.endedAt,
        args.success,
        args.failure,
        args.cancellation,
      ),
    );
  }

  get id(): TaskId {
    return this._id;
  }
  get agent(): string {
    return this._agent;
  }
  get brief(): string {
    return this._brief;
  }
  get details(): string | undefined {
    return this._details;
  }
  get origin(): TaskOrigin {
    return this._origin;
  }
  /** Routing id for a cross-package origin; `undefined` for standalone. */
  get originId(): string | undefined {
    return this._originId;
  }
  get status(): TaskStatus {
    return this._status;
  }
  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }

  /**
   * Read a single metadata value as a non-empty string, or `undefined` when the
   * key is absent, not a string, or empty. Gives the application layer typed
   * access to the bag without hand-rolled `typeof` narrowing at every call
   * site; the entity still never interprets a key's meaning — callers name the
   * runtime-bookkeeping key they need (e.g. `"runtime"`, `"runtimeSessionId"`).
   */
  metadataString(key: string): string | undefined {
    const value = this._metadata[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  get createdAt(): string {
    return this._createdAt;
  }
  get startedAt(): string {
    return this._startedAt;
  }
  get endedAt(): string | undefined {
    return this._endedAt;
  }
  get success(): TaskSuccess | undefined {
    return this._success;
  }
  get failure(): TaskFailure | undefined {
    return this._failure;
  }
  get cancellation(): TaskCancellation | undefined {
    return this._cancellation;
  }

  // ─── state transitions ────────────────────────────────────

  /** Transition `running → succeeded`, attaching the success payload. */
  complete(
    success: TaskSuccess,
    opts: TaskTransitionOpts = {},
  ): Result<TaskEntity, InvalidTransition> {
    if (this._status !== "running") {
      return err({ type: "InvalidTransition", from: this._status, eventType: "complete" });
    }
    return ok(
      this.transition({
        status: "succeeded",
        endedAt: opts.now ?? new Date().toISOString(),
        success,
        metadata: this.mergeMetadata(opts.metadata),
      }),
    );
  }

  /** Transition `running → failed`, attaching `failure` for visibility. */
  fail(failure: TaskFailure, opts: TaskTransitionOpts = {}): Result<TaskEntity, InvalidTransition> {
    if (this._status !== "running") {
      return err({ type: "InvalidTransition", from: this._status, eventType: "fail" });
    }
    return ok(
      this.transition({
        status: "failed",
        endedAt: opts.now ?? new Date().toISOString(),
        failure,
        metadata: this.mergeMetadata(opts.metadata),
      }),
    );
  }

  /** Transition `running → cancelled`. */
  cancel(
    cancellation: TaskCancellation,
    opts: TaskTransitionOpts = {},
  ): Result<TaskEntity, InvalidTransition> {
    if (this._status !== "running") {
      return err({ type: "InvalidTransition", from: this._status, eventType: "cancel" });
    }
    return ok(
      this.transition({
        status: "cancelled",
        endedAt: opts.now ?? new Date().toISOString(),
        cancellation,
        metadata: this.mergeMetadata(opts.metadata),
      }),
    );
  }

  /**
   * Replace the metadata bag wholesale, preserving status + timing +
   * terminal payload. Pure metadata enrichment, so it cannot fail.
   */
  withMetadata(metadata: Readonly<Record<string, unknown>>): TaskEntity {
    return new TaskEntity(
      this._id,
      this._agent,
      this._brief,
      this._details,
      this._origin,
      this._originId,
      this._status,
      Object.freeze({ ...metadata }),
      this._createdAt,
      this._startedAt,
      this._endedAt,
      this._success,
      this._failure,
      this._cancellation,
    );
  }

  // ─── internals ─────────────────────────────────────────────

  private transition(patch: {
    readonly status: TaskStatus;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly endedAt?: string;
    readonly success?: TaskSuccess;
    readonly failure?: TaskFailure;
    readonly cancellation?: TaskCancellation;
  }): TaskEntity {
    return new TaskEntity(
      this._id,
      this._agent,
      this._brief,
      this._details,
      this._origin,
      this._originId,
      patch.status,
      patch.metadata,
      this._createdAt,
      this._startedAt,
      patch.endedAt !== undefined ? patch.endedAt : this._endedAt,
      patch.success !== undefined ? patch.success : this._success,
      patch.failure !== undefined ? patch.failure : this._failure,
      patch.cancellation !== undefined ? patch.cancellation : this._cancellation,
    );
  }

  private mergeMetadata(
    patch: Readonly<Record<string, unknown>> | undefined,
  ): Readonly<Record<string, unknown>> {
    if (patch === undefined) return this._metadata;
    return Object.freeze({ ...this._metadata, ...patch });
  }
}

// ─── payload shape validators ───────────────────────────────
// Each returns a violation message, or `null` when the shape is valid.

function taskSuccessViolation(value: TaskSuccess): string | null {
  if (value === null || typeof value !== "object") return "task.success must be an object";
  const v = value as { output?: unknown };
  if (v.output !== null && typeof v.output !== "string") {
    return "task.success.output must be a string or null";
  }
  return null;
}

function taskFailureViolation(value: TaskFailure): string | null {
  if (value === null || typeof value !== "object") return "task.failure must be an object";
  const v = value as { kind?: unknown; message?: unknown; exitCode?: unknown; signal?: unknown };
  if (typeof v.kind !== "string" || !FAILURE_KINDS.has(v.kind)) {
    return `task.failure.kind must be one of: ${[...FAILURE_KINDS].join(", ")}`;
  }
  if (typeof v.message !== "string") return "task.failure.message must be a string";
  if (v.kind === "execution") {
    const hasExitCode = typeof v.exitCode === "number";
    const hasSignal = typeof v.signal === "string";
    if (hasExitCode === hasSignal) {
      return "task.failure must carry exactly one of exitCode or signal when kind='execution'";
    }
  }
  return null;
}

function taskCancellationViolation(value: TaskCancellation): string | null {
  if (value === null || typeof value !== "object") return "task.cancellation must be an object";
  const v = value as { kind?: unknown; message?: unknown };
  if (typeof v.kind !== "string" || !CANCELLATION_KINDS.has(v.kind)) {
    return `task.cancellation.kind must be one of: ${[...CANCELLATION_KINDS].join(", ")}`;
  }
  if (typeof v.message !== "string") return "task.cancellation.message must be a string";
  return null;
}
