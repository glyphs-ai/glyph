import { eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { __Entity__Entity } from "../../domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../domain/__entity-kebab__-id.js";
import type {
  __Entity__NotFound,
  __Entity__Repository,
  DatabaseUnavailable,
} from "../../domain/__entity-kebab__-repository.js";
import type { Db } from "./__entity-kebab__-db.js";
import { __Entity__Mapper } from "./__entity-kebab__-mapper.js";
import { __entities__ } from "./__entity-kebab__-schema.js";

/** Drizzle-backed write-side adapter for {@link __Entity__Repository}. */
export class Drizzle__Entity__Repository implements __Entity__Repository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  private static asDatabaseUnavailable(cause: unknown): DatabaseUnavailable {
    return { type: "DatabaseUnavailable", cause };
  }

  get(id: __Entity__Id): ResultAsync<__Entity__Entity, __Entity__NotFound | DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => this.db.select().from(__entities__).where(eq(__entities__.id, id)).get())(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    ).andThen((row) => {
      if (!row)
        return errAsync<__Entity__Entity, __Entity__NotFound>({ type: "__Entity__NotFound", id });
      return okAsync(__Entity__Mapper.toDomain(row));
    });
  }

  save(entity: __Entity__Entity): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        const row = __Entity__Mapper.toRow(entity);
        this.db
          .insert(__entities__)
          .values(row)
          .onConflictDoUpdate({ target: __entities__.id, set: row })
          .run();
      })(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    ).map(() => undefined);
  }

  delete(id: __Entity__Id): ResultAsync<void, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      (async () => {
        this.db.delete(__entities__).where(eq(__entities__.id, id)).run();
      })(),
      Drizzle__Entity__Repository.asDatabaseUnavailable,
    ).map(() => undefined);
  }
}
