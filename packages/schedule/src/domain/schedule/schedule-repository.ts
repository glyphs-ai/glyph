import type { ResultAsync } from "neverthrow";
import type { ScheduleEntity } from "./schedule-entity.js";
import type { ScheduleCorruption } from "./schedule-errors.js";
import type { ScheduleId } from "./schedule-id.js";

/** Persistence fault atom for repository IO failures (the SQLite driver threw). */
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

/** Business outcome for a missing schedule row. */
export type ScheduleNotFound = {
  readonly type: "ScheduleNotFound";
  readonly id: string;
};

/**
 * CQRS write-side repository for the mutable schedule aggregate. Uniform
 * `get` / `save` / `delete` — `save` handles both create (an untracked, freshly
 * `create()`d aggregate ⇒ INSERT) and update (an aggregate loaded via `get` ⇒
 * UPDATE only the changed columns), diffing against the row snapshot the
 * adapter captured at `get` time. Raw db access (composing SELECTs over the
 * tables) is exposed ONLY by the read-side `ScheduleQueries`; this write side
 * never hands out `db`.
 *
 * `get` asserts existence (`ScheduleNotFound` when the id resolves to zero
 * rows) and surfaces `ScheduleCorruption` for a row that violates the stored
 * grammar. `save` returns only `DatabaseUnavailable`. `ScheduleId` is branded +
 * parsed at the use-case boundary, so the repo takes no invalid-id path.
 */
export interface ScheduleRepository {
  /** Load the aggregate for mutation (fire / patch / delete / run); tracks its snapshot. */
  get(
    id: ScheduleId,
  ): ResultAsync<ScheduleEntity, ScheduleNotFound | DatabaseUnavailable | ScheduleCorruption>;

  /**
   * Persist the aggregate: INSERT when untracked (freshly created), else
   * UPDATE only the columns that diverged from the snapshot captured at `get`.
   */
  save(entity: ScheduleEntity): ResultAsync<void, DatabaseUnavailable>;

  delete(id: ScheduleId): ResultAsync<void, DatabaseUnavailable>;
}
