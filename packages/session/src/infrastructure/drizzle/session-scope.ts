/**
 * Request-scoped accessor for session infrastructure.
 */

import type { Db, Tx } from "./session-db.js";
import { DrizzleSessionQueries } from "./session-queries.js";
import { DrizzleSessionRepository } from "./session-repository.js";

export interface SessionScope {
  readonly repo: DrizzleSessionRepository;
  readonly queries: DrizzleSessionQueries;
}

export function createSessionScope(tx: Tx, db: Db): SessionScope {
  let _repo: DrizzleSessionRepository | undefined;
  let _queries: DrizzleSessionQueries | undefined;
  return {
    get repo() {
      if (!_repo) _repo = new DrizzleSessionRepository({ db: tx });
      return _repo;
    },
    get queries() {
      if (!_queries) _queries = new DrizzleSessionQueries({ db });
      return _queries;
    },
  };
}
