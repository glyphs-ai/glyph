import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionEntity } from "../../domain/session-entity.js";
import type { SessionId } from "../../domain/session-id.js";
import type {
  DatabaseUnavailable,
  SessionNotFound,
  SessionRepository,
} from "../../domain/session-repository.js";
import type { Tx } from "./session-db.js";
import { SessionMapper, type SessionRow } from "./session-mapper.js";
import { sessions } from "./session-schema.js";

/**
 * Drizzle-backed write-side adapter for {@link SessionRepository}.
 *
 * Change-tracking lives here, not on the entity: `get` snapshots the loaded
 * row into a `WeakMap` keyed on the returned entity; `save` looks the entity
 * up — absent ⇒ INSERT (a freshly `create()`d aggregate, may hit the PRIMARY
 * KEY), present ⇒ diff the current row against the snapshot and UPDATE only
 * the changed columns (or no-op).
 */
export class DrizzleSessionRepository implements SessionRepository {
  private readonly db: Tx;
  private readonly snapshots = new WeakMap<SessionEntity, SessionRow>();

  constructor(opts: { db: Tx }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: SessionId): ResultAsync<SessionEntity, SessionNotFound | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.select().from(sessions).where(eq(sessions.id, id)).get(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    ).andThen((row) => {
      if (!row) return errAsync<SessionEntity, SessionNotFound>({ type: "SessionNotFound", id });
      const entity = SessionMapper.toDomain(row);
      this.snapshots.set(entity, SessionMapper.toRow(entity));
      return okAsync(entity);
    });
  }

  save(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable> {
    const snapshot = this.snapshots.get(entity);
    const current = SessionMapper.toRow(entity);
    if (snapshot === undefined) {
      return ResultAsync.fromPromise(
        this.db.insert(sessions).values(current).run(),
        DrizzleSessionRepository.asDatabaseUnavailable,
      ).map(() => this.track(entity, current));
    }
    const diff = diffRow(snapshot, current);
    if (Object.keys(diff).length === 0) return okAsync(undefined);
    return ResultAsync.fromPromise(
      this.db.update(sessions).set(diff).where(eq(sessions.id, entity.id)).run(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    ).map(() => this.track(entity, current));
  }

  delete(id: SessionId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      this.db.delete(sessions).where(eq(sessions.id, id)).run(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    ).map(() => undefined);
  }

  /** Record the persisted row as the entity's tracked snapshot. */
  private track(entity: SessionEntity, row: SessionRow): void {
    this.snapshots.set(entity, row);
  }
}

/**
 * Shallow column-wise diff: the subset of `current`'s columns whose value
 * differs from `snapshot`. All session columns are primitives (string |
 * null), so identity comparison is exact.
 */
function diffRow(snapshot: SessionRow, current: SessionRow): Partial<SessionRow> {
  const diff: Partial<SessionRow> = {};
  for (const key of Object.keys(current) as (keyof SessionRow)[]) {
    if (current[key] !== snapshot[key]) {
      diff[key] = current[key] as SessionRow[keyof SessionRow] as never;
    }
  }
  return diff;
}
