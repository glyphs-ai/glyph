import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { __Entity__Entity } from "../../domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../domain/__entity-kebab__-id.js";
import type {
  __Entity__IdConflict,
  __Entity__NotFound,
  __Entity__Repository,
  DatabaseUnavailable,
} from "../../domain/__entity-kebab__-repository.js";
import type { Db } from "./__entity-kebab__-db.js";
import { __Entity__Mapper } from "./__entity-kebab__-mapper.js";
import { __entities__ } from "./__entity-kebab__-schema.js";

/** Drizzle-backed adapter for {@link __Entity__Repository}. */
export class Drizzle__Entity__Repository implements __Entity__Repository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: __Entity__Id): ResultAsync<__Entity__Entity, __Entity__NotFound | DatabaseUnavailable> {
    return this.findById(id).andThen(
      (entity): ResultAsync<__Entity__Entity, __Entity__NotFound | DatabaseUnavailable> =>
        entity === undefined ? errAsync({ type: "__Entity__NotFound", id }) : okAsync(entity),
    );
  }

  findById(id: __Entity__Id): ResultAsync<__Entity__Entity | undefined, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(__entities__).where(eq(__entities__.id, id)).get())(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    ).map((row) => (row ? __Entity__Mapper.toDomain(row) : undefined));
  }

  list(): ResultAsync<__Entity__Entity[], DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(__entities__).orderBy(__entities__.createdAt).all())(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    ).map((rows) => rows.map((row) => __Entity__Mapper.toDomain(row)));
  }

  insert(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable | __Entity__IdConflict> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.insert(__entities__).values(__Entity__Mapper.toRow(entity)).run();
      })(),
      (cause) => this.translateInsertError(cause, entity),
    );
  }

  save(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db
          .update(__entities__)
          .set(__Entity__Mapper.toRow(entity))
          .where(eq(__entities__.id, entity.id))
          .run();
      })(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    );
  }

  delete(id: __Entity__Id): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(__entities__).where(eq(__entities__.id, id)).run();
      })(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    );
  }

  /** Translate a SQLite PRIMARY KEY violation into `__Entity__IdConflict`. */
  private translateInsertError(
    cause: unknown,
    entity: __Entity__Entity,
  ): DatabaseUnavailable | __Entity__IdConflict {
    const e = cause as { code?: string };
    if (typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) {
      return { type: "__Entity__IdConflict", id: entity.id };
    }
    return Drizzle__Entity__Repository.asDatabaseUnavailable(cause);
  }
}
