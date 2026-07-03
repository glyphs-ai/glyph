/**
 * Per-kind handler port + the atoms use-cases raise when routing through it.
 *
 * The handler is intentionally THROW-based (exactly like workflow's
 * `WorkflowNodeRunner`): implementations live in `packages/api/src/wiring/*`
 * and bridge to `@glyphs-ai/task` / `@glyphs-ai/catalog`, which throw today.
 * Application use-cases wrap each call with `ResultAsync.fromPromise(...)` and
 * translate a throw into the {@link TargetValidationFailed} atom at the
 * boundary. Keeping the port throw-based means those api handlers need no
 * rewrite.
 *
 * The interface is deliberately non-generic. Per-kind type safety lives at the
 * EDGES: route handlers narrow `unknown` → typed shape before `create`;
 * handlers cast `unknown` right after their own `validate`. A
 * `ScheduleKindHandler<TData>` generic would defeat the open-registry goal.
 */
export interface ScheduleKindHandler {
  /**
   * Validate an inbound `data` payload. MUST throw on invalid shape; MAY do
   * async side-effects (e.g. catalog existence lookup). Returns the
   * validated / normalized payload, which the substrate persists as
   * `envelope.data`. On patch re-validation `opts.changedKeys` lists the
   * top-level keys the merge touched, so the handler MAY skip cross-checks
   * whose inputs did not change.
   */
  validate(data: unknown, opts?: { readonly changedKeys?: readonly string[] }): Promise<unknown>;

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
  }): Promise<{ readonly id: string }>;

  /**
   * Whether this kind currently has a dispatched-but-incomplete unit-of-work
   * for `scheduleId`. Used by the delete pre-flight AND the fire path's
   * concurrency check.
   */
  hasInFlightForSchedule(scheduleId: string): Promise<boolean>;

  /**
   * Cascade-delete the kind's historical units-of-work for `scheduleId`.
   * Returns count removed. Implementations MUST filter to terminal status
   * only, to defend against a TOCTOU between the delete pre-flight and this.
   */
  deleteForSchedule(scheduleId: string): Promise<{ readonly deletedCount: number }>;
}

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
 * The throw-based `handler.validate` rejected an inbound `data` payload.
 * Carries the thrown `cause` so the server error-policy can unwrap the
 * kind-specific detail (e.g. the task kind's agent-not-found). The substrate
 * stays kind-agnostic.
 */
export type TargetValidationFailed = {
  readonly type: "TargetValidationFailed";
  readonly kind: string;
  readonly cause: unknown;
};
