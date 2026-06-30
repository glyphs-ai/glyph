import { and, eq, gte, type SQL } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionEntity } from "../../domain/session-entity.js";
import type { SessionId } from "../../domain/session-id.js";
import type {
  DatabaseUnavailable,
  FindAllSessionsFilter,
  SessionIdConflict,
  SessionNotFound,
  SessionRepository,
} from "../../domain/session-repository.js";
import type { Db } from "./session-db.js";
import { SessionMapper } from "./session-mapper.js";
import { sessions } from "./session-schema.js";

/** Drizzle-backed adapter for {@link SessionRepository}. */
export class DrizzleSessionRepository implements SessionRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: SessionId): ResultAsync<SessionEntity, SessionNotFound | DatabaseUnavailable> {
    return this.findById(id).andThen(
      (entity): ResultAsync<SessionEntity, SessionNotFound | DatabaseUnavailable> =>
        entity === undefined ? errAsync({ type: "SessionNotFound", id }) : okAsync(entity),
    );
  }

  findById(id: SessionId): ResultAsync<SessionEntity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(sessions).where(eq(sessions.id, id)).get())(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    ).map((row) => (row ? SessionMapper.toDomain(row) : undefined));
  }

  findAll(filter: FindAllSessionsFilter): ResultAsync<SessionEntity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const filters: SQL[] = [];
        if (filter.createdSince !== undefined) {
          filters.push(gte(sessions.createdAt, filter.createdSince));
        }
        if (filter.agent !== undefined) filters.push(eq(sessions.agent, filter.agent));
        const query = this.db.select().from(sessions);
        return filters.length > 0 ? query.where(and(...filters)).all() : query.all();
      })(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    ).map((rows) => rows.map((row) => SessionMapper.toDomain(row)));
  }

  insert(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable | SessionIdConflict> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.insert(sessions).values(SessionMapper.toRow(entity)).run();
      })(),
      (cause) => this.translateInsertError(cause, entity),
    );
  }

  save(entity: SessionEntity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db
          .update(sessions)
          .set(SessionMapper.toRow(entity))
          .where(eq(sessions.id, entity.id))
          .run();
      })(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    );
  }

  delete(id: SessionId): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(sessions).where(eq(sessions.id, id)).run();
      })(),
      DrizzleSessionRepository.asDatabaseUnavailable,
    );
  }

  /** Translate a SQLite PRIMARY KEY violation into `SessionIdConflict`. */
  private translateInsertError(
    cause: unknown,
    entity: SessionEntity,
  ): DatabaseUnavailable | SessionIdConflict {
    const e = cause as { code?: string };
    if (typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) {
      return { type: "SessionIdConflict", id: entity.id };
    }
    return DrizzleSessionRepository.asDatabaseUnavailable(cause);
  }
}
