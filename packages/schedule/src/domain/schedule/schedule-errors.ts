/**
 * Business error atoms for the schedule domain — discriminated unions keyed
 * on `type` (no error classes). Each use-case composes its own Error union
 * from these; consumers `switch (err.type)` for exhaustive narrowing.
 *
 * Repository IO atoms (`DatabaseUnavailable`, `ScheduleNotFound`) live with
 * the repository port in `schedule-repository.ts`; cron atoms
 * (`InvalidCronExpr`, `InvalidTimezone`) live with the cron service in
 * `cron.ts`; the id atom (`InvalidScheduleId`) lives in `schedule-id.ts`.
 */

/** A schedule name is not a non-empty trimmed string. */
export type InvalidScheduleName = {
  readonly type: "InvalidScheduleName";
};

/**
 * A patch attempted to change `target.kind` on an existing row. Changing
 * the kind of a persisted schedule is not supported.
 */
export type TargetKindImmutable = {
  readonly type: "TargetKindImmutable";
  readonly id: string;
  readonly current: string;
  readonly attempted: string;
};

/** A schedule cannot be deleted while still enabled; disable it first. */
export type ScheduleEnabled = {
  readonly type: "ScheduleEnabled";
  readonly id: string;
};

/**
 * A schedule cannot be deleted while a fired dispatch is still in flight
 * (surfaced by the kind handler's `hasInFlightForSchedule`).
 */
export type ScheduleHasInFlight = {
  readonly type: "ScheduleHasInFlight";
  readonly id: string;
};

/**
 * The schedule exists but does not have the kind required by a
 * kind-discriminated route (e.g. `PATCH /task/:sid` on a `:sid` whose
 * `target.kind !== "task"`). The HTTP layer projects this to a plain 404
 * so the wire shape does not leak whether the resource exists under
 * another kind; the distinct atom lets the route branch unambiguously.
 */
export type ScheduleKindMismatch = {
  readonly type: "ScheduleKindMismatch";
  readonly id: string;
  readonly expected: string;
  readonly actual: string;
};

/** A persisted schedule row violates the domain's stored grammar. */
export type ScheduleCorruption = {
  readonly type: "ScheduleCorruption";
  readonly id: string;
  readonly reason: string;
};
