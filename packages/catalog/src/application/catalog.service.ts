import { randomUUID } from "node:crypto";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import pino, { type Logger } from "pino";
import type {
  Agent,
  AgentEntry,
  AgentResolveResult,
  Mcp,
  Skill,
  SkillEntry,
  SkillResolveResult,
} from "../contract/catalog.types.js";
import * as McpFormat from "../domain/mcp.format.js";
import { defaultFetcherRegistry } from "../fetcher/index.js";
import { AgentRepository } from "../persistence/agent.repository.js";
import { McpRepository } from "../persistence/mcp.repository.js";
import { SkillRepository } from "../persistence/skill.repository.js";
import type * as schema from "../persistence/tables.js";
import { AgentService } from "./agent.service.js";
import type {
  CatalogInstallResult,
  CatalogPlan,
  CatalogSyncResult,
  McpResolveAdapter,
} from "./catalog.plan-types.js";
import * as installOps from "./catalog.service/install.js";
import * as reads from "./catalog.service/reads.js";
import * as resolveOps from "./catalog.service/resolve.js";
import type { CachedPlan, CatalogRuntime, CatalogServiceCtx } from "./catalog.service/types.js";
import { type McpFetcher, McpService } from "./mcp.service.js";
import { type SkillFetcher, SkillService } from "./skill.service.js";

const silentLogger: Logger = pino({ level: "silent" });

const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Construction options for {@link buildCatalogRuntime}.
 */
export interface BuildCatalogRuntimeOpts {
  readonly db: BetterSQLite3Database<typeof schema>;
  readonly logger?: Logger;
}

export type { CatalogRuntime, CatalogServiceCtx };

export interface CatalogServiceOpts {
  readonly runtime: CatalogRuntime;
}

export function buildCatalogRuntime(opts: BuildCatalogRuntimeOpts): CatalogRuntime {
  const fetchers = defaultFetcherRegistry();
  const logger = opts.logger ?? silentLogger;

  const mcpRepo = new McpRepository({ db: opts.db, logger });
  const skillRepo = new SkillRepository({ db: opts.db, logger });
  const agentRepo = new AgentRepository({ db: opts.db, logger });

  const mcpFetcher: McpFetcher = (origin) =>
    fetchers.dispatchFile(origin, "").then((b) => b.toString("utf8"));
  const skillFetcher: SkillFetcher = {
    async fetchAnchor(origin) {
      const buf = await fetchers.dispatchFile(origin, "SKILL.md");
      return buf.toString("utf8");
    },
    fetchTree(origin) {
      return fetchers.dispatchTree(origin);
    },
  };
  const agentFetcher = {
    async fetchAnchor(origin: string) {
      const buf = await fetchers.dispatchFile(origin, "AGENTS.md");
      return buf.toString("utf8");
    },
    fetchTree(origin: string) {
      return fetchers.dispatchTree(origin);
    },
  };

  const mcp = new McpService({ repo: mcpRepo, fetcher: mcpFetcher });
  const skill = new SkillService({
    repo: skillRepo,
    fetcher: skillFetcher,
    siblings: { mcps: mcpRepo },
  });
  const agent = new AgentService({
    repo: agentRepo,
    fetcher: agentFetcher,
    siblings: {
      skills: skillRepo,
      mcps: mcpRepo,
    },
  });

  const resolveMcpAdapter: McpResolveAdapter = async (origin) => {
    try {
      const buf = await fetchers.dispatchFile(origin, "");
      const content = buf.toString("utf8");
      const parsed = McpFormat.parse(content, `resolve:${origin}`);
      const name = parsed.meta.name;
      const merged = McpFormat.writeMeta(content, { name }, `resolve:${origin}`);
      return { node: { fqn: name, origin, content: merged }, conflict: null };
    } catch (cause) {
      return {
        node: null,
        conflict: {
          kind: "mcp",
          origin,
          fqn: null,
          reason: { kind: "fetch-failed", cause },
        },
      };
    }
  };

  return {
    mcp,
    skill,
    agent,
    mcpRepo,
    skillRepo,
    agentRepo,
    resolveMcpAdapter,
    logger,
  };
}

/**
 * Unified catalog facade. Holds both write (install / update / delete)
 * and read (list / get / resolve / dependent-lookup) operations.
 *
 * Reads and writes share the same backing per-entity services/repos —
 * writes are immediately visible to subsequent reads with no cache
 * invalidation. The single in-memory `planCache` powers the
 * preview/apply UX (`cachePlan` / `takePlan`).
 */
export class CatalogService {
  private readonly planCache = new Map<string, CachedPlan>();
  private readonly ctx: CatalogServiceCtx;

  constructor(opts: CatalogServiceOpts) {
    this.ctx = { rt: opts.runtime, planCache: this.planCache };
  }

  // ─── Install ──────────────────────────────────────────
  install(plan: CatalogPlan): Promise<CatalogInstallResult> {
    return installOps.install(this.ctx, plan);
  }
  async installSkill(origin: string): Promise<CatalogInstallResult> {
    return this.install(await this.resolveSkill(origin));
  }
  async installAgent(origin: string): Promise<CatalogInstallResult> {
    return this.install(await this.resolveAgentFromOrigin(origin));
  }
  async installMcpFromOrigin(origin: string): Promise<CatalogInstallResult> {
    return this.install(await this.resolveMcp(origin));
  }
  applySync(plan: CatalogPlan): Promise<CatalogSyncResult> {
    return installOps.applySync(this.ctx, plan);
  }

  // ─── Per-entry flag flips ────────────────────────────
  acknowledgeSkillPrereqs(fqn: string): Promise<Skill> {
    return reads.acknowledgeSkillPrereqs(this.ctx, fqn);
  }
  acknowledgeAgentPrereqs(fqn: string): Promise<Agent> {
    return reads.acknowledgeAgentPrereqs(this.ctx, fqn);
  }
  disableAgent(fqn: string): Promise<Agent> {
    return reads.disableAgent(this.ctx, fqn);
  }
  enableAgent(fqn: string): Promise<Agent> {
    return reads.enableAgent(this.ctx, fqn);
  }

  // ─── Deletes (dep-protection raised by the repo layer) ────
  async deleteAgent(fqn: string): Promise<void> {
    await this.ctx.rt.agent.delete(fqn);
  }
  async deleteSkill(fqn: string): Promise<void> {
    await this.ctx.rt.skill.delete(fqn);
  }
  async deleteMcp(fqn: string): Promise<void> {
    await this.ctx.rt.mcp.delete(fqn);
  }

  // ─── Resolve (cross-entity walk, no writes) ──────────
  resolveSkill(origin: string): Promise<CatalogPlan> {
    return resolveOps.resolveSkill(this.ctx, origin);
  }
  resolveAgentFromOrigin(origin: string): Promise<CatalogPlan> {
    return resolveOps.resolveAgentFromOrigin(this.ctx, origin);
  }
  resolveMcp(origin: string): Promise<CatalogPlan> {
    return resolveOps.resolveMcp(this.ctx, origin);
  }
  resolveSyncSkill(fqn: string): Promise<CatalogPlan> {
    return resolveOps.resolveSyncSkill(this.ctx, fqn);
  }
  resolveSyncAgent(fqn: string): Promise<CatalogPlan> {
    return resolveOps.resolveSyncAgent(this.ctx, fqn);
  }
  resolveSyncMcp(name: string): Promise<CatalogPlan> {
    return resolveOps.resolveSyncMcp(this.ctx, name);
  }

  // ─── Preview/apply token cache ───────────────────────
  cachePlan(plan: CatalogPlan): string {
    this.evictExpiredPlans();
    const token = randomUUID();
    this.planCache.set(token, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
    return token;
  }

  takePlan(token: string): CatalogPlan | null {
    const entry = this.planCache.get(token);
    if (entry === undefined) return null;
    this.planCache.delete(token);
    return entry.expiresAt < Date.now() ? null : entry.plan;
  }

  private evictExpiredPlans(): void {
    const now = Date.now();
    for (const [token, entry] of this.planCache) {
      if (entry.expiresAt < now) this.planCache.delete(token);
    }
  }

  // ─── Listing / lookup with DTO projection ─────────────
  listSkillEntries(): Promise<SkillEntry[]> {
    return reads.listSkillEntries(this.ctx);
  }
  listAgentEntries(): Promise<AgentEntry[]> {
    return reads.listAgentEntries(this.ctx);
  }
  listMcps(): Promise<Mcp[]> {
    return reads.listMcps(this.ctx);
  }
  listSkills(): Promise<Skill[]> {
    return reads.listSkills(this.ctx);
  }
  listAgents(): Promise<Agent[]> {
    return reads.listAgents(this.ctx);
  }
  getSkillEntry(fqn: string): Promise<SkillEntry | null> {
    return reads.getSkillEntry(this.ctx, fqn);
  }
  getAgentEntry(fqn: string): Promise<AgentEntry | null> {
    return reads.getAgentEntry(this.ctx, fqn);
  }
  getSkillContent(fqn: string): Promise<string> {
    return reads.getSkillContent(this.ctx, fqn);
  }
  getAgentContent(fqn: string): Promise<string> {
    return reads.getAgentContent(this.ctx, fqn);
  }
  listAgentFiles(fqn: string): Promise<{ relPath: string; size: number }[]> {
    return reads.listAgentFiles(this.ctx, fqn);
  }
  listSkillFiles(fqn: string): Promise<{ relPath: string; size: number }[]> {
    return reads.listSkillFiles(this.ctx, fqn);
  }
  getAgentFile(fqn: string, relPath: string): Promise<Buffer | null> {
    return reads.getAgentFile(this.ctx, fqn, relPath);
  }
  getSkillFile(fqn: string, relPath: string): Promise<Buffer | null> {
    return reads.getSkillFile(this.ctx, fqn, relPath);
  }
  getMcpContent(fqn: string): Promise<string> {
    return reads.getMcpContent(this.ctx, fqn);
  }
  getMcpRuntimeConfig(fqn: string): Promise<Record<string, unknown>> {
    return reads.getMcpRuntimeConfig(this.ctx, fqn);
  }
  getSkill(fqn: string): Promise<Skill | null> {
    return reads.getSkill(this.ctx, fqn);
  }
  getAgent(fqn: string): Promise<Agent | null> {
    return reads.getAgent(this.ctx, fqn);
  }
  getMcp(name: string): Promise<Mcp | null> {
    return reads.getMcp(this.ctx, name);
  }

  // ─── Entity lists (rich entities, for callers that need methods) ─
  listMcpEntities() {
    return reads.listMcpEntities(this.ctx);
  }
  listSkillEntities() {
    return reads.listSkillEntities(this.ctx);
  }
  listAgentEntities() {
    return reads.listAgentEntities(this.ctx);
  }

  // ─── Streaming files (runtime materialisation) ───────
  agentEntries(fqn: string) {
    return reads.agentEntries(this.ctx, fqn);
  }
  skillEntries(fqn: string) {
    return reads.skillEntries(this.ctx, fqn);
  }

  // ─── Resolve from local catalog (runtime-facing reads) ─
  resolveAgent(fqn: string): Promise<AgentResolveResult> {
    return reads.resolveAgent(this.ctx, fqn);
  }
  resolveSkillFromCatalog(fqn: string): Promise<SkillResolveResult> {
    return reads.resolveSkillFromCatalog(this.ctx, fqn);
  }

  // ─── Reverse-dep lookups ─────────────────────────────
  findSkillDependents(targetFqn: string) {
    return reads.findSkillDependents(this.ctx, targetFqn);
  }
  findMcpDependents(targetFqn: string) {
    return reads.findMcpDependents(this.ctx, targetFqn);
  }
  findAgentDependents(targetFqn: string) {
    return reads.findAgentDependents(this.ctx, targetFqn);
  }
  findDependents(targetFqn: string) {
    return reads.findDependents(this.ctx, targetFqn);
  }
}
