/**
 * Request-scoped accessor for schedule infrastructure.
 */

import type { Db } from "./schedule-db.js";
import { DrizzleScheduleQueries } from "./schedule-queries.js";
import { DrizzleScheduleRepository } from "./schedule-repository.js";

export interface ScheduleScope {
  readonly repo: DrizzleScheduleRepository;
  readonly queries: DrizzleScheduleQueries;
}

export function createScheduleScope(tx: Db, db: Db): ScheduleScope {
  let _repo: DrizzleScheduleRepository | undefined;
  let _queries: DrizzleScheduleQueries | undefined;
  return {
    get repo() {
      if (!_repo) _repo = new DrizzleScheduleRepository({ db: tx });
      return _repo;
    },
    get queries() {
      if (!_queries) _queries = new DrizzleScheduleQueries({ db });
      return _queries;
    },
  };
}
