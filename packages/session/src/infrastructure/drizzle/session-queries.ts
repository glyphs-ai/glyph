import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/session-repository.js";
import type { Db } from "./session-db.js";
import { sessions } from "./session-db.js";

/**
 * Read-side port for the session CQRS query model. Exposes the table so
 * read use-cases compose their own SELECTs (by-id, filtered list) and run
 * them through {@link SessionQueries.query}, which captures a driver throw
 * as `DatabaseUnavailable`. The interface lives beside its Drizzle
 * implementation (not in the domain) because it deliberately exposes the
 * Drizzle handle + table object — the read side is intentionally
 * infrastructure-coupled. The private `db` is never handed out raw;
 * callers only reach it inside the `query` lambda.
 */
export interface SessionQueries {
  readonly sessions: typeof sessions;
  /** Run one read fn; a driver throw becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleSessionQueries implements SessionQueries {
  private readonly db: Db;
  readonly sessions = sessions;

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
