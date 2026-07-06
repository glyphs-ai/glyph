import { err, ok, type Result } from "neverthrow";
import type { ScheduleKindHandler, ScheduleKindNotRegistered } from "./schedule-kind-handler.js";

/**
 * Kind-name grammar: lowercase ASCII letter first, then lowercase letters /
 * digits / underscore / hyphen. Rules out empty / whitespace-only / uppercase
 * registrations (the kind appears in `schedules.target_kind` and in operator
 * error messages).
 */
const KIND_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/** A `register` call used a name outside the kind-name grammar. */
export type InvalidScheduleKindName = {
  readonly type: "InvalidScheduleKindName";
  readonly kind: string;
};

/** The same kind was registered twice on one registry. */
export type ScheduleKindAlreadyRegistered = {
  readonly type: "ScheduleKindAlreadyRegistered";
  readonly kind: string;
};

/** `register` was called after `recover()` froze the registry. */
export type ScheduleKindRegistryFrozen = {
  readonly type: "ScheduleKindRegistryFrozen";
  readonly kind: string;
};

export type RegisterKindError =
  | InvalidScheduleKindName
  | ScheduleKindAlreadyRegistered
  | ScheduleKindRegistryFrozen;

/**
 * Open registry of per-kind handlers. The substrate has no built-in knowledge
 * of any concrete kind; callers register handlers at compose time, then
 * `recover()` freezes the registry.
 *
 * Result-native: `register` / `handlerFor` return `Result` rather than
 * throwing; the composition root converts an `isErr()` into a throw to trigger
 * teardown.
 *
 * The registry is a shared concern: the command use-cases read it
 * (`handlerFor`) and the engine both reads it (fire/recover) and freezes it
 * (recover). It is injected into both.
 */
export interface ScheduleKindRegistry {
  /** Compose-time only. Errs on invalid name / duplicate / frozen. */
  register(kind: string, handler: ScheduleKindHandler): Result<void, RegisterKindError>;
  /** Freeze the registry; subsequent `register` errs. Idempotent. */
  freeze(): void;
  has(kind: string): boolean;
  /** Read path for use-cases + engine; errs when the kind is unregistered. */
  handlerFor(kind: string): Result<ScheduleKindHandler, ScheduleKindNotRegistered>;
}

export class DefaultScheduleKindRegistry implements ScheduleKindRegistry {
  private readonly handlers = new Map<string, ScheduleKindHandler>();
  private frozen = false;

  register(kind: string, handler: ScheduleKindHandler): Result<void, RegisterKindError> {
    if (!KIND_NAME_RE.test(kind)) return err({ type: "InvalidScheduleKindName", kind });
    if (this.frozen) return err({ type: "ScheduleKindRegistryFrozen", kind });
    if (this.handlers.has(kind)) return err({ type: "ScheduleKindAlreadyRegistered", kind });
    this.handlers.set(kind, handler);
    return ok(undefined);
  }

  freeze(): void {
    this.frozen = true;
  }

  has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  handlerFor(kind: string): Result<ScheduleKindHandler, ScheduleKindNotRegistered> {
    const handler = this.handlers.get(kind);
    return handler === undefined ? err({ type: "ScheduleKindNotRegistered", kind }) : ok(handler);
  }
}
