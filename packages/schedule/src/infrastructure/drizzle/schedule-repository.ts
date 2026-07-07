import { eq } from "drizzle-orm";
import { err, okAsync, ResultAsync } from "neverthrow";
import type { ScheduleEntity } from "../../domain/schedule/schedule-entity.js";
import type { ScheduleCorruption } from "../../domain/schedule/schedule-errors.js";
import type { ScheduleId } from "../../domain/schedule/schedule-id.js";
import type {
  DatabaseUnavailable,
  ScheduleNotFound,
  ScheduleRepository,
} from "../../domain/schedule/schedule-repository.js";
import type { Db } from "./schedule-db.js";
import { ScheduleMapper } from "./schedule-mapper.js";
import { type NewScheduleRow, schedules } from "./schedule-schema.js";

/**
 * Drizzle-backed write-side adapter for {@link ScheduleRepository}. Wraps the
 * async libsql calls so any driver fault becomes `DatabaseUnavailable`.
 *
 * Change-tracking lives here, not on the entity: `get` snapshots the loaded
 * row into a `WeakMap` keyed on the returned entity; `save` looks the entity
 * up — absent ⇒ INSERT (a freshly `create()`d aggregate), present ⇒ diff the
 * current row against the snapshot and UPDATE only the changed columns (or
 * no-op). The `WeakMap` releases entries when the entity is garbage-collected,
 * so there is nothing to clean up per request. `get` surfaces
 * `ScheduleCorruption` for a row that violates the stored grammar.
 */
export class DrizzleScheduleRepository implements ScheduleRepository {
  private readonly db: Db;
  private readonly snapshots = new WeakMap<ScheduleEntity, NewScheduleRow>();

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(
    id: ScheduleId,
  ): ResultAsync<ScheduleEntity, ScheduleNotFound | DatabaseUnavailable | ScheduleCorruption> {
    return ResultAsync.fromPromise(
      this.db.select().from(schedules).where(eq(schedules.id, id)).get(),
      DrizzleScheduleRepository.asDatabaseUnavailable,
    ).andThen((row) => {
      if (row === undefined) {
        return err<ScheduleEntity, ScheduleNotFound | ScheduleCorruption>({
          type: "ScheduleNotFound" as const,
          id,
        });
      }
      return ScheduleMapper.toEntity(row).map((entity) => {
        this.track(entity, ScheduleMapper.toRow(entity));
        return entity;
      });
    });
  }

  save(entity: ScheduleEntity): ResultAsync<void, DatabaseUnavailable> {
    const current = ScheduleMapper.toRow(entity);
    const snapshot = this.snapshots.get(entity);
    if (snapshot === undefined) {
      return ResultAsync.fromPromise(
        this.db.insert(schedules).values(current).run(),
        DrizzleScheduleRepository.asDatabaseUnavailable,
      ).map(() => this.track(entity, current));
    }
    const diff = diffRow(snapshot, current);
    if (Object.keys(diff).length === 0) return okAsync(undefined);
    return ResultAsync.fromPromise(
      this.db.update(schedules).set(diff).where(eq(schedules.id, entity.id)).run(),
      DrizzleScheduleRepository.asDatabaseUnavailable,
    ).map(() => this.track(entity, current));
  }

  delete(id: ScheduleId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.delete(schedules).where(eq(schedules.id, id)).run(),
      DrizzleScheduleRepository.asDatabaseUnavailable,
    ).map(() => undefined);
  }

  /** Record the persisted row as the entity's tracked snapshot. */
  private track(entity: ScheduleEntity, row: NewScheduleRow): void {
    this.snapshots.set(entity, row);
  }
}

/**
 * Shallow column-wise diff of two rows: the subset of `current`'s columns
 * whose value differs from `snapshot`. Every schedule column is a primitive
 * (string | number | boolean | null) — `target_json` is a serialized string —
 * so identity comparison is exact.
 */
function diffRow(snapshot: NewScheduleRow, current: NewScheduleRow): Partial<NewScheduleRow> {
  const diff: Partial<NewScheduleRow> = {};
  for (const key of Object.keys(current) as (keyof NewScheduleRow)[]) {
    if (current[key] !== snapshot[key]) {
      diff[key] = current[key] as NewScheduleRow[keyof NewScheduleRow] as never;
    }
  }
  return diff;
}
