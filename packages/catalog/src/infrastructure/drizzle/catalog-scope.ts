/**
 * Request-scoped accessor for catalog infrastructure. Repos receive the
 * transaction handle (`tx`) so writes participate in the request's atomic
 * unit; queries receive the stable `db` handle for committed-snapshot reads.
 *
 * Instances are lazily constructed on first property access (one per request).
 */

import { DrizzleAgentRepository } from "./agent-repository.js";
import type { Db, Tx } from "./catalog-db.js";
import { DrizzleCatalogQueries } from "./catalog-queries.js";
import { DrizzleMcpRepository } from "./mcp-repository.js";
import { DrizzleSkillRepository } from "./skill-repository.js";

export interface CatalogScope {
  readonly agentRepo: DrizzleAgentRepository;
  readonly skillRepo: DrizzleSkillRepository;
  readonly mcpRepo: DrizzleMcpRepository;
  readonly queries: DrizzleCatalogQueries;
}

export function createCatalogScope(tx: Tx, db: Db): CatalogScope {
  let _agentRepo: DrizzleAgentRepository | undefined;
  let _skillRepo: DrizzleSkillRepository | undefined;
  let _mcpRepo: DrizzleMcpRepository | undefined;
  let _queries: DrizzleCatalogQueries | undefined;
  return {
    get agentRepo() {
      if (!_agentRepo) _agentRepo = new DrizzleAgentRepository({ db: tx });
      return _agentRepo;
    },
    get skillRepo() {
      if (!_skillRepo) _skillRepo = new DrizzleSkillRepository({ db: tx });
      return _skillRepo;
    },
    get mcpRepo() {
      if (!_mcpRepo) _mcpRepo = new DrizzleMcpRepository({ db: tx });
      return _mcpRepo;
    },
    get queries() {
      if (!_queries) _queries = new DrizzleCatalogQueries({ db });
      return _queries;
    },
  };
}
