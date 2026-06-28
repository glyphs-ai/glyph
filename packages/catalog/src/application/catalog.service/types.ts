import type { Logger } from "pino";

import type { AgentRepository } from "../../persistence/agent.repository.js";
import type { McpRepository } from "../../persistence/mcp.repository.js";
import type { SkillRepository } from "../../persistence/skill.repository.js";
import type { AgentService } from "../agent.service.js";
import type { CatalogPlan, McpResolveAdapter } from "../catalog.plan-types.js";
import type { McpService } from "../mcp.service.js";
import type { SkillService } from "../skill.service.js";

export interface CatalogServiceCtx {
  readonly rt: CatalogRuntime;
  readonly planCache: Map<string, CachedPlan>;
}

export interface CachedPlan {
  readonly plan: CatalogPlan;
  readonly expiresAt: number;
}

/**
 * Internal handle binding the per-entity services + repos + adapter
 * used by {@link CatalogService}. Constructed once by
 * {@link buildCatalogRuntime}; tests can build it manually with
 * fake per-entity services for cross-entity facade tests.
 */
export interface CatalogRuntime {
  readonly mcp: McpService;
  readonly skill: SkillService;
  readonly agent: AgentService;
  readonly mcpRepo: McpRepository;
  readonly skillRepo: SkillRepository;
  readonly agentRepo: AgentRepository;
  readonly resolveMcpAdapter: McpResolveAdapter;
  readonly logger: Logger;
}
