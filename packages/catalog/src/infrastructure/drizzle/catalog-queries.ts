/**
 * CQRS read-side seam for the catalog. Interface + drizzle implementation are
 * co-located here (not in `domain/`) because reads return raw persisted rows,
 * NOT domain entities — the read side is intentionally infrastructure-coupled
 * and decoupled from the aggregate invariants.
 *
 * Unlike the repositories (which expose typed `get` / `save` / `delete` for the
 * write side), the read side is a single generic `query<T>(fn)`: a read
 * use-case composes its own drizzle SELECT against the full catalog `db`
 * (every table on one handle) and runs it through `query`, which captures a
 * driver throw as `DatabaseUnavailable`. Centralising the try/catch here is the
 * one place the read side turns a driver fault into `DatabaseUnavailable`, so
 * no read use-case repeats `ResultAsync.fromPromise(...)`.
 */

import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { Db } from "./catalog-db.js";

export interface CatalogQueries {
  /** Run one read fn against the catalog db; a driver throw becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleCatalogQueries implements CatalogQueries {
  private readonly db: Db;

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
