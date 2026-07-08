/**
 * Request-scoped accessor for task infrastructure.
 */

import type { Logger } from "pino";
import type { Db } from "./task-db.js";
import { DrizzleTaskQueries } from "./task-queries.js";
import { DrizzleTaskRepository } from "./task-repository.js";

export interface TaskScope {
  readonly repo: DrizzleTaskRepository;
  readonly queries: DrizzleTaskQueries;
}

export function createTaskScope(tx: Db, db: Db, logger?: Logger): TaskScope {
  let _repo: DrizzleTaskRepository | undefined;
  let _queries: DrizzleTaskQueries | undefined;
  return {
    get repo() {
      if (!_repo)
        _repo = new DrizzleTaskRepository(logger !== undefined ? { db: tx, logger } : { db: tx });
      return _repo;
    },
    get queries() {
      if (!_queries) _queries = new DrizzleTaskQueries({ db });
      return _queries;
    },
  };
}
