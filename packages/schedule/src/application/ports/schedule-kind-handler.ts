import type { ResultAsync } from "neverthrow";

/**
 * Per-kind handler port + the atoms use-cases raise when routing through it.
 *
 * The handler is a Result-native adapter: implementations live in
 * `packages/api/src/wiring/*` and bridge to `@glyphs-ai/task` /
 * `@glyphs-ai/workflow` / `@glyphs-ai/catalog`. Each fallible call returns a
 * {@link HandlerFault} carrying the underlying cause; the calling use-case
 * unwraps it and translates into its own atom at the boundary (e.g.
 * {@link TargetValidationFailed} for `validate`, `DatabaseUnavailable` for the
 * dispatch / lifecycle calls). The substrate stays kind-agnostic — the fault is
 * an opaque `cause`, never a kind-specific error type.
 *
 * The interface is deliberately non-generic. Per-kind type safety lives at the
 * EDGES: route handlers narrow `unknown` → typed shape before `create`;
 * handlers cast `unknown` right after their own `validate`. A
 * `ScheduleKindHandler<TData>` generic would defeat the open-registry goal.
 */
export interface ScheduleKindHandler {
  /**
   * Validate an inbound `data` payload. Errs with {@link HandlerFault} on
   * invalid shape; MAY do async side-effects (e.g. catalog existence lookup).
   * Returns the validated / normalized payload, which the substrate persists as
   * `envelope.data`. On patch re-validation `opts.changedKeys` lists the
   * top-level keys the merge touched, so the handler MAY skip cross-checks
   * whose inputs did not change.
   */
  validate(
    data: unknown,
    opts?: { readonly changedKeys?: readonly string[] },
  ): ResultAsync<unknown, HandlerFault>;

  /**
   * Apply an RFC 7396-style patch to an existing `data` payload, returning
   * the merged result + the top-level keys that actually changed. Pure,
   * sync, no IO. Pre-condition: `existing` is the latest persisted `data`
   * for a row of this kind (a value this handler's own `validate` produced).
   */
  mergePatch(
    existing: unknown,
    patch: unknown,
  ): { readonly data: unknown; readonly changedKeys: readonly string[] };

  /**
   * Dispatch the target as a fire-event. Receives already-validated `data`.
   * Returns a substrate-side identifier (task id, workflow run id, …) for
   * audit and for the manual-run `dispatchId` return.
   */
  dispatch(opts: {
    readonly scheduleId: string;
    readonly firedAt: string;
    readonly data: unknown;
  }): ResultAsync<{ readonly id: string }, HandlerFault>;

  /**
   * Whether this kind currently has a dispatched-but-incomplete unit-of-work
   * for `scheduleId`. Used by the delete pre-flight AND the fire path's
   * concurrency check.
   */
  hasInFlightForSchedule(scheduleId: string): ResultAsync<boolean, HandlerFault>;

  /**
   * Cascade-delete the kind's historical units-of-work for `scheduleId`.
   * Returns count removed. Implementations MUST filter to terminal status
   * only, to defend against a TOCTOU between the delete pre-flight and this.
   */
  deleteForSchedule(
    scheduleId: string,
  ): ResultAsync<{ readonly deletedCount: number }, HandlerFault>;
}

/**
 * An opaque substrate fault surfaced by a kind handler — a validation reject,
 * a dispatch failure, or a lifecycle IO fault. Kind-agnostic: it carries only
 * the underlying `cause`, which the calling use-case unwraps + translates into
 * its own error atom at the boundary.
 */
export type HandlerFault = { readonly cause: unknown };

/**
 * A per-request operation named a kind with no registered handler
 * (`create` / `patch` / `run` / `delete` referencing an unknown kind). An
 * operator-config bug surfaced inside a use-case → the route maps it to 500.
 * (Distinct from the compose-time registry throws, which crash the workspace
 * load before any route runs.)
 */
export type ScheduleKindNotRegistered = {
  readonly type: "ScheduleKindNotRegistered";
  readonly kind: string;
};

/**
 * The handler's `validate` rejected an inbound `data` payload (surfaced as a
 * {@link HandlerFault}). Carries the underlying `cause` so the server error-policy can unwrap the
 * kind-specific detail (e.g. the task kind's agent-not-found). The substrate
 * stays kind-agnostic.
 */
export type TargetValidationFailed = {
  readonly type: "TargetValidationFailed";
  readonly kind: string;
  readonly cause: unknown;
};
