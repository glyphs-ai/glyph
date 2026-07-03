import { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "../../domain/schedule/schedule-repository.js";
import type { Db } from "./schedule-db.js";
import { schedules } from "./schedule-schema.js";

/**
 * Read-side port for the schedule CQRS query model. Exposes the table so read
 * use-cases compose their own SELECTs (incl. DB-side filters / ORDER BY) and
 * run them through {@link ScheduleQueries.query}, which captures a driver throw
 * as `DatabaseUnavailable`. The interface lives beside its Drizzle
 * implementation (not in the domain) because it deliberately exposes the
 * Drizzle handle + table object — the read side is intentionally
 * infrastructure-coupled. The private `db` is never handed out raw; callers
 * only reach it inside the `query` lambda.
 */
export interface ScheduleQueries {
  readonly schedules: typeof schedules;
  /** Run one read fn; a driver throw becomes DatabaseUnavailable. */
  query<T>(fn: (db: Db) => T): ResultAsync<T, DatabaseUnavailable>;
}

export class DrizzleScheduleQueries implements ScheduleQueries {
  private readonly db: Db;
  readonly schedules = schedules;

  constructor(opts: { readonly db: Db }) {
    this.db = opts.db;
  }

  query<T>(fn: (db: Db) => T): ResultAsync<T, DatabaseUnavailable> {
    return ResultAsync.fromPromise(
      Promise.resolve().then(() => fn(this.db)),
      (cause) => ({ type: "DatabaseUnavailable", cause }),
    );
  }
}
