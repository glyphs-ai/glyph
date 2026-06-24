import type { Logger } from "pino";

import type { AgentRepository } from "../../agent/agent-repository.js";
import type { AgentService } from "../../agent/agent-service.js";
import type { McpRepository } from "../../mcp/mcp-repository.js";
import type { McpService } from "../../mcp/mcp-service.js";
import type { SkillRepository } from "../../skill/skill-repository.js";
import type { SkillService } from "../../skill/skill-service.js";
import type { CatalogPlan, McpResolveAdapter } from "../plan-types.js";

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
