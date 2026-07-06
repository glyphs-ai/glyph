import { err, ok, type Result } from "neverthrow";
import type { InvalidScheduleName, TargetKindImmutable } from "./schedule-errors.js";
import type { ScheduleId } from "./schedule-id.js";
import type { ScheduleTargetEnvelope } from "./schedule-target.js";
import {
  type InvalidCronExpr,
  type InvalidTimezone,
  type ScheduleTrigger,
  validateTrigger,
} from "./schedule-trigger.js";

/** Args for {@link ScheduleEntity.create} — the kind-agnostic fields a caller supplies. */
export interface CreateScheduleArgs {
  readonly name: string;
  readonly trigger: ScheduleTrigger;
  readonly target: ScheduleTargetEnvelope;
  readonly enabled?: boolean;
}

/** Args for {@link ScheduleEntity.rehydrate} — a fully-formed, already-validated row. */
export interface RehydrateScheduleArgs {
  readonly id: ScheduleId;
  readonly name: string;
  readonly trigger: ScheduleTrigger;
  readonly target: ScheduleTargetEnvelope;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastFiredAt?: string;
  readonly nextFireAt?: string;
}

/**
 * Mutable schedule aggregate. Holds kind-agnostic state + invariants; every
 * self-mutation edits the aggregate IN PLACE (transitions that can fail return
 * a sync `Result<void>` carrying their atom; pure ones return `void`). The
 * repository owns change-tracking (a `WeakMap` snapshot keyed on the entity),
 * so mutating in place lets a loaded aggregate be `save`d back as a diff.
 *
 * Row↔entity mapping lives in the infrastructure mapper, NOT here. The
 * entity does NOT introspect `target.data` (opaque — the kind handler owns
 * its shape) and does NOT compute cron; `nextFireAt` is fed in via
 * {@link withNextFireAt} / {@link recordFired} by the use-case or engine
 * that owns the clock. It DOES enforce cron LEGALITY: the factory and
 * {@link withTrigger} run {@link validateTrigger} so a trigger is always
 * well-formed.
 */
export class ScheduleEntity {
  private constructor(
    private readonly _id: ScheduleId,
    private _name: string,
    private _trigger: ScheduleTrigger,
    private _target: ScheduleTargetEnvelope,
    private _enabled: boolean,
    private readonly _createdAt: string,
    private _updatedAt: string,
    private _lastFiredAt: string | undefined,
    private _nextFireAt: string | undefined,
  ) {}

  get id(): ScheduleId {
    return this._id;
  }
  get name(): string {
    return this._name;
  }
  get trigger(): ScheduleTrigger {
    return this._trigger;
  }
  get target(): ScheduleTargetEnvelope {
    return this._target;
  }
  get enabled(): boolean {
    return this._enabled;
  }
  get createdAt(): string {
    return this._createdAt;
  }
  get updatedAt(): string {
    return this._updatedAt;
  }
  get lastFiredAt(): string | undefined {
    return this._lastFiredAt;
  }
  get nextFireAt(): string | undefined {
    return this._nextFireAt;
  }

  /**
   * Create a fresh schedule. Validates name + trigger legality; the target
   * data is opaque (the use-case ran `handler.validate` and replaced `data`
   * with the validated value before calling this).
   */
  static create(
    args: CreateScheduleArgs,
    ctx: { readonly id: ScheduleId; readonly now: Date },
  ): Result<ScheduleEntity, InvalidScheduleName | InvalidCronExpr | InvalidTimezone> {
    if (!isNonEmptyName(args.name)) return err({ type: "InvalidScheduleName" });
    return validateTrigger(args.trigger).map(() => {
      const nowIso = ctx.now.toISOString();
      return new ScheduleEntity(
        ctx.id,
        args.name,
        args.trigger,
        { kind: args.target.kind, data: args.target.data },
        args.enabled ?? true,
        nowIso,
        nowIso,
        undefined,
        undefined,
      );
    });
  }

  /**
   * Rehydrate from already-validated parts. Called by the infrastructure
   * mapper AFTER it has parsed + corruption-checked the row; performs no
   * validation of its own.
   */
  static rehydrate(args: RehydrateScheduleArgs): ScheduleEntity {
    return new ScheduleEntity(
      args.id,
      args.name,
      args.trigger,
      args.target,
      args.enabled,
      args.createdAt,
      args.updatedAt,
      args.lastFiredAt,
      args.nextFireAt,
    );
  }

  /**
   * Scalar set of `name` / `enabled` (+`updatedAt`), in place. Either field
   * is optional; validates `name` when present.
   */
  withMetadata(
    patch: { readonly name?: string; readonly enabled?: boolean },
    now: Date,
  ): Result<void, InvalidScheduleName> {
    if (patch.name !== undefined && !isNonEmptyName(patch.name)) {
      return err({ type: "InvalidScheduleName" });
    }
    if (patch.name !== undefined) this._name = patch.name;
    if (patch.enabled !== undefined) this._enabled = patch.enabled;
    this._updatedAt = now.toISOString();
    return ok(undefined);
  }

  /** Replace the trigger atomically (+`updatedAt`), in place. Re-validates the new value. */
  withTrigger(
    trigger: ScheduleTrigger,
    now: Date,
  ): Result<void, InvalidCronExpr | InvalidTimezone> {
    const validated = validateTrigger(trigger);
    if (validated.isErr()) return err(validated.error);
    this._trigger = trigger;
    this._updatedAt = now.toISOString();
    return ok(undefined);
  }

  /**
   * Replace the target envelope wholesale (+`updatedAt`), in place. The
   * use-case composes the merged patch (via the handler's `mergePatch` +
   * `validate`) BEFORE calling this — the entity does no merging. The new
   * envelope's `kind` MUST match the existing kind.
   */
  withTarget(envelope: ScheduleTargetEnvelope, now: Date): Result<void, TargetKindImmutable> {
    if (envelope.kind !== this._target.kind) {
      return err({
        type: "TargetKindImmutable",
        id: this._id,
        current: this._target.kind,
        attempted: envelope.kind,
      });
    }
    this._target = { kind: envelope.kind, data: envelope.data };
    this._updatedAt = now.toISOString();
    return ok(undefined);
  }

  /**
   * Record a fire, in place — sets `lastFiredAt` + `nextFireAt`. Does NOT
   * stamp `updatedAt` (firing is scheduler bookkeeping, not a user edit).
   */
  recordFired(firedAt: string, nextFireAt: string | undefined): void {
    this._lastFiredAt = firedAt;
    this._nextFireAt = nextFireAt;
  }

  /**
   * Set or clear `nextFireAt` in place without touching `lastFiredAt` or
   * `updatedAt`. Used to pre-arm a freshly-created schedule and to recompute
   * the next fire on a trigger/enabled change.
   */
  withNextFireAt(nextFireAt: string | undefined): void {
    this._nextFireAt = nextFireAt;
  }
}

function isNonEmptyName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0;
}
