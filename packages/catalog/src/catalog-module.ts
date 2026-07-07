/**
 * Composition root for `@glyphs-ai/catalog`.
 *
 * Opens the SQLite handle, wires repositories, sources, and the fetcher
 * registry into use-cases, and returns a `CatalogModule` for host code.
 */

import { AcknowledgeAgentPrereqsUseCase } from "./application/agent/acknowledge-agent-prereqs.js";
import { DisableAgentUseCase } from "./application/agent/disable-agent.js";
import { EnableAgentUseCase } from "./application/agent/enable-agent.js";
import { GetAgentUseCase } from "./application/agent/get-agent.js";
import { GetAgentContentUseCase } from "./application/agent/get-agent-content.js";
import { GetAgentEntryUseCase } from "./application/agent/get-agent-entry.js";
import { GetAgentFileUseCase } from "./application/agent/get-agent-file.js";
import { InstallAgentUseCase } from "./application/agent/install-agent.js";
import { ListAgentEntriesUseCase } from "./application/agent/list-agent-entries.js";
import { ListAgentFilesUseCase } from "./application/agent/list-agent-files.js";
import { ListAgentsUseCase } from "./application/agent/list-agents.js";
import { ResolveAgentUseCase } from "./application/agent/resolve-agent.js";
import { UninstallAgentUseCase } from "./application/agent/uninstall-agent.js";
import { GetMcpUseCase } from "./application/mcp/get-mcp.js";
import { GetMcpByOriginUseCase } from "./application/mcp/get-mcp-by-origin.js";
import { GetMcpContentUseCase } from "./application/mcp/get-mcp-content.js";
import { InstallMcpUseCase } from "./application/mcp/install-mcp.js";
import { ListMcpsUseCase } from "./application/mcp/list-mcps.js";
import { UninstallMcpUseCase } from "./application/mcp/uninstall-mcp.js";
import { ApplyPlanUseCase } from "./application/resolution/apply-plan.js";
import { GetTreeUseCase } from "./application/resolution/get-tree.js";
import { GetUpstreamTreeUseCase } from "./application/resolution/get-upstream-tree.js";
import { ResolvePlanUseCase } from "./application/resolution/resolve-plan.js";
import { AcknowledgePrereqsUseCase } from "./application/skill/acknowledge-skill-prereqs.js";
import { GetSkillUseCase } from "./application/skill/get-skill.js";
import { GetSkillByOriginUseCase } from "./application/skill/get-skill-by-origin.js";
import { GetSkillContentUseCase } from "./application/skill/get-skill-content.js";
import { GetSkillEntryUseCase } from "./application/skill/get-skill-entry.js";
import { GetSkillFileUseCase } from "./application/skill/get-skill-file.js";
import { InstallSkillUseCase } from "./application/skill/install-skill.js";
import { ListSkillEntriesUseCase } from "./application/skill/list-skill-entries.js";
import { ListSkillFilesUseCase } from "./application/skill/list-skill-files.js";
import { ListSkillsUseCase } from "./application/skill/list-skills.js";
import { UninstallSkillUseCase } from "./application/skill/uninstall-skill.js";
import { DrizzleAgentRepository } from "./infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "./infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "./infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "./infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "./infrastructure/drizzle/skill-repository.js";
import { defaultRegistry } from "./infrastructure/source/fetcher/registry.js";
import { JsonMcpSource } from "./infrastructure/source/json-mcp-source.js";
import { MarkdownAgentSource } from "./infrastructure/source/markdown-agent-source.js";
import { MarkdownSkillSource } from "./infrastructure/source/markdown-skill-source.js";

export type CatalogModuleOptions =
  | { readonly db: Db; readonly dbFile?: never }
  | { readonly dbFile: string; readonly db?: never };

export interface CatalogModule {
  readonly installAgent: InstallAgentUseCase;
  readonly installSkill: InstallSkillUseCase;
  readonly installMcp: InstallMcpUseCase;
  readonly getUpstreamTree: GetUpstreamTreeUseCase;
  readonly getTree: GetTreeUseCase;
  readonly resolvePlan: ResolvePlanUseCase;
  readonly applyPlan: ApplyPlanUseCase;
  readonly uninstallAgent: UninstallAgentUseCase;
  readonly uninstallSkill: UninstallSkillUseCase;
  readonly uninstallMcp: UninstallMcpUseCase;
  readonly enableAgent: EnableAgentUseCase;
  readonly disableAgent: DisableAgentUseCase;
  readonly acknowledgeSkillPrereqs: AcknowledgePrereqsUseCase;
  readonly acknowledgeAgentPrereqs: AcknowledgeAgentPrereqsUseCase;
  readonly getAgent: GetAgentUseCase;
  readonly getAgentEntry: GetAgentEntryUseCase;
  readonly getAgentContent: GetAgentContentUseCase;
  readonly listAgentFiles: ListAgentFilesUseCase;
  readonly getAgentFile: GetAgentFileUseCase;
  readonly resolveAgent: ResolveAgentUseCase;
  readonly getSkillEntry: GetSkillEntryUseCase;
  readonly getSkill: GetSkillUseCase;
  readonly getSkillByOrigin: GetSkillByOriginUseCase;
  readonly getSkillContent: GetSkillContentUseCase;
  readonly listSkillFiles: ListSkillFilesUseCase;
  readonly getSkillFile: GetSkillFileUseCase;
  readonly getMcp: GetMcpUseCase;
  readonly getMcpByOrigin: GetMcpByOriginUseCase;
  readonly getMcpContent: GetMcpContentUseCase;
  readonly listAgentEntries: ListAgentEntriesUseCase;
  readonly listSkillEntries: ListSkillEntriesUseCase;
  readonly listAgents: ListAgentsUseCase;
  readonly listSkills: ListSkillsUseCase;
  readonly listMcps: ListMcpsUseCase;
  /** Closes the underlying SQLite connection. Idempotent. */
  close(): Promise<void>;
}

export async function composeCatalog(opts: CatalogModuleOptions): Promise<CatalogModule> {
  let db: Db;
  let closeDb: () => void;
  if ("db" in opts && opts.db !== undefined) {
    db = opts.db;
    closeDb = () => {};
  } else {
    const opened = await openDb(opts.dbFile as string);
    db = opened.db;
    closeDb = opened.close;
  }
  const registry = defaultRegistry();

  const agentRepo = new DrizzleAgentRepository({ db });
  const skillRepo = new DrizzleSkillRepository({ db });
  const mcpRepo = new DrizzleMcpRepository({ db });
  const queries = new DrizzleCatalogQueries({ db });

  const agentSource = new MarkdownAgentSource(registry);
  const skillSource = new MarkdownSkillSource(registry);
  const mcpSource = new JsonMcpSource(registry);

  const installAgent = new InstallAgentUseCase({ agentSource, agentRepo });
  const installSkill = new InstallSkillUseCase({ skillSource, skillRepo });
  const installMcp = new InstallMcpUseCase({ mcpSource, mcpRepo });

  const getUpstreamTree = new GetUpstreamTreeUseCase({
    skill: skillSource,
    agent: agentSource,
    mcp: mcpSource,
  });
  const getTree = new GetTreeUseCase({ queries });
  const repos = { skill: skillRepo, agent: agentRepo, mcp: mcpRepo };

  return {
    installAgent,
    installSkill,
    installMcp,
    getUpstreamTree,
    getTree,
    resolvePlan: new ResolvePlanUseCase({ getUpstreamTree, getTree, queries }),
    applyPlan: new ApplyPlanUseCase({ installSkill, installAgent, installMcp, repos }),
    uninstallAgent: new UninstallAgentUseCase({ agentRepo, queries }),
    uninstallSkill: new UninstallSkillUseCase({ skillRepo, queries }),
    uninstallMcp: new UninstallMcpUseCase({ mcpRepo, queries }),
    enableAgent: new EnableAgentUseCase({ agentRepo }),
    disableAgent: new DisableAgentUseCase({ agentRepo }),
    acknowledgeSkillPrereqs: new AcknowledgePrereqsUseCase({ skillRepo, queries }),
    acknowledgeAgentPrereqs: new AcknowledgeAgentPrereqsUseCase({ agentRepo }),
    getAgent: new GetAgentUseCase({ queries }),
    getAgentEntry: new GetAgentEntryUseCase({ queries }),
    getAgentContent: new GetAgentContentUseCase({ queries }),
    listAgentFiles: new ListAgentFilesUseCase({ queries }),
    getAgentFile: new GetAgentFileUseCase({ queries }),
    resolveAgent: new ResolveAgentUseCase({ queries }),
    getSkillEntry: new GetSkillEntryUseCase({ queries }),
    getSkill: new GetSkillUseCase({ queries }),
    getSkillByOrigin: new GetSkillByOriginUseCase({ queries }),
    getSkillContent: new GetSkillContentUseCase({ queries }),
    listSkillFiles: new ListSkillFilesUseCase({ queries }),
    getSkillFile: new GetSkillFileUseCase({ queries }),
    getMcp: new GetMcpUseCase({ queries }),
    getMcpByOrigin: new GetMcpByOriginUseCase({ queries }),
    getMcpContent: new GetMcpContentUseCase({ queries }),
    listAgentEntries: new ListAgentEntriesUseCase({ queries }),
    listSkillEntries: new ListSkillEntriesUseCase({ queries }),
    listAgents: new ListAgentsUseCase({ queries }),
    listSkills: new ListSkillsUseCase({ queries }),
    listMcps: new ListMcpsUseCase({ queries }),
    async close() {
      closeDb();
    },
  };
}
