import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/__entity-kebab__-repository.js";
import type { Db } from "./__entity-kebab__-db.js";
import { __entities__ } from "./__entity-kebab__-schema.js";

/**
 * Read-side port for the __Entity__ CQRS query model. Exposes the table so
 * read use-cases compose their own SELECTs and run them through
 * {@link __Entity__Queries.query}, which captures driver failures as
 * `DatabaseUnavailable`. The interface lives beside its Drizzle implementation
 * because the read side intentionally exposes infrastructure concerns.
 */
export interface __Entity__Queries {
  readonly __entities__: typeof __entities__;
  /** Run one read fn; a driver throw/rejection becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable>;
}

export class Drizzle__Entity__Queries implements __Entity__Queries {
  private readonly db: Db;
  readonly __entities__ = __entities__;

  constructor(opts: { readonly db: Db }) {
    this.db = opts.db;
  }

  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() => fn(this.db)),
      (cause) => ({ type: "DatabaseUnavailable", cause }),
    );
  }
}
