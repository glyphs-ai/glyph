/**
 * Request-scoped accessor for workflow infrastructure.
 */

import type { Logger } from "pino";
import type { Db } from "./workflow-db.js";
import { DrizzleWorkflowQueries } from "./workflow-queries.js";
import { DrizzleWorkflowRepository } from "./workflow-repository.js";

export interface WorkflowScope {
  readonly repo: DrizzleWorkflowRepository;
  readonly queries: DrizzleWorkflowQueries;
}

export function createWorkflowScope(tx: Db, db: Db, logger?: Logger): WorkflowScope {
  let _repo: DrizzleWorkflowRepository | undefined;
  let _queries: DrizzleWorkflowQueries | undefined;
  return {
    get repo() {
      if (!_repo)
        _repo = new DrizzleWorkflowRepository(
          logger !== undefined ? { db: tx, logger } : { db: tx },
        );
      return _repo;
    },
    get queries() {
      if (!_queries) _queries = new DrizzleWorkflowQueries({ db });
      return _queries;
    },
  };
}
