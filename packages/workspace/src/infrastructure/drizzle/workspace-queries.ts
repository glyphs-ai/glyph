import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/workspace-repository.js";
import type { Db } from "./workspace-db.js";
import { workspaces } from "./workspace-db.js";

/**
 * Read-side port for the workspace CQRS query model. Exposes the table so
 * read use-cases compose their own SELECTs (incl. DB-side ORDER BY / path
 * lookups) and run them through {@link WorkspaceQueries.query}, which
 * captures a driver throw as `DatabaseUnavailable`. The interface lives
 * beside its Drizzle implementation (not in the domain) because it
 * deliberately exposes the Drizzle handle + table object — the read side
 * is intentionally infrastructure-coupled. The private `db` is never
 * handed out raw; callers only reach it inside the `query` lambda.
 */
export interface WorkspaceQueries {
  readonly workspaces: typeof workspaces;
  /** Run one read fn; a driver throw/rejection becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T | Promise<T>): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleWorkspaceQueries implements WorkspaceQueries {
  private readonly db: Db;
  readonly workspaces = workspaces;

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
