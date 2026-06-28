import {
  AgentNotFoundError,
  AgentOriginConflictError,
  AgentPlanStaleError,
} from "../contract/agent.errors.js";
import { AgentEntity } from "../domain/agent.entity.js";
import { AgentFrontmatterError, AgentUnresolvedDepError } from "../domain/agent.errors.js";
import { AGENT_DEP_SPECS, type AgentDepKind } from "../domain/agent.frontmatter.js";
import { normaliseOriginDeps, type OriginDeps } from "../domain/catalog.dep-keys.js";
import { Origin } from "../domain/origin.js";
import type { EntryFile } from "../fetcher/index.js";
import { safeNormalize, sameOrigin } from "../fetcher/origin.js";
import type { AgentFile, AgentRepository } from "../persistence/agent.repository.js";
import type { McpRepository } from "../persistence/mcp.repository.js";
import type { SkillRepository } from "../persistence/skill.repository.js";

export interface AgentFetcher {
  fetchAnchor(origin: string): Promise<string>;
  fetchTree(origin: string): AsyncIterable<EntryFile>;
}

// Per-kind resolve types. Mirrored from the skill side by intent —
// agent and skill are independent kinds and intentionally don't share
// a base class or shared resolve-types module. Duplication beats
// domain coupling: the moment either kind grows a kind-specific field
// the shared abstraction has to either widen or fork — both worse
// than copying ~30 LOC.

export type AgentResolveEvent =
  | { type: "fetching"; origin: string }
  | { type: "fetched"; origin: string; fqn: string }
  | { type: "alreadyInstalled"; fqn: string }
  | { type: "failed"; origin: string; error: unknown };

export interface AgentResolveOpts {
  onProgress?: (event: AgentResolveEvent) => void;
}

export interface AgentResolvedNode {
  readonly fqn: string;
  readonly origin: string;
  readonly anchorContent: string;
  readonly version: string;
  readonly depsRefs: OriginDeps<AgentDepKind>;
}

export type AgentResolveConflict = {
  readonly origin: string;
  readonly fqn: string | null;
  readonly reason:
    | { kind: "fetch-failed"; cause: unknown }
    | { kind: "parse-failed"; cause: unknown }
    | { kind: "origin-conflict"; existingOrigin: string };
};

export interface AgentResolvePlan {
  readonly node: AgentResolvedNode | null;
  readonly conflict: AgentResolveConflict | null;
}

/**
 * Pure resolve workflow: fetch the anchor bytes, parse them into an
 * `AgentEntity`, check for origin conflicts against the local repo,
 * build the resolved-node payload. Returns `{node, conflict}` — the
 * caller maps the conflict to `AgentOriginConflictError`.
 *
 * Mirrors `resolveSkillOrigin` in `skill/skill-service.ts` by intent;
 * the two copies are independent and must NOT be re-factored into a
 * shared helper.
 */
async function resolveAgentOrigin(opts: {
  readonly origin: string;
  readonly fetcher: AgentFetcher;
  readonly repo: AgentRepository;
  readonly onProgress?: (event: AgentResolveEvent) => void;
}): Promise<AgentResolvePlan> {
  const { origin, fetcher, repo } = opts;
  const onProgress = opts.onProgress ?? (() => {});

  onProgress({ type: "fetching", origin });
  let anchorBytes: string;
  try {
    anchorBytes = await fetcher.fetchAnchor(origin);
  } catch (cause) {
    onProgress({ type: "failed", origin, error: cause });
    return {
      node: null,
      conflict: { origin, fqn: null, reason: { kind: "fetch-failed", cause } },
    };
  }

  let entity: AgentEntity;
  try {
    entity = AgentEntity.create(
      anchorBytes,
      Origin.parse(safeNormalize(origin)),
      `resolve:${origin}`,
    );
  } catch (cause) {
    onProgress({ type: "failed", origin, error: cause });
    return {
      node: null,
      conflict: { origin, fqn: null, reason: { kind: "parse-failed", cause } },
    };
  }

  const existing = await repo.findById(entity.fqn);
  if (existing !== undefined && !sameOrigin(existing.origin, entity.origin)) {
    return {
      node: null,
      conflict: {
        origin,
        fqn: entity.fqn,
        reason: { kind: "origin-conflict", existingOrigin: existing.origin },
      },
    };
  }

  const depsRefs = normaliseOriginDeps(AGENT_DEP_SPECS, entity.depsRefs);
  const node: AgentResolvedNode = {
    fqn: entity.fqn,
    origin: entity.origin,
    anchorContent: anchorBytes,
    version: entity.version,
    depsRefs,
  };
  onProgress({ type: "fetched", origin, fqn: node.fqn });
  return { node, conflict: null };
}

/**
 * Application-layer service for agent operations. Agent owns its
 * resolve workflow inline (see `resolveAgentOrigin` above) plus its
 * resolve-result types declared in this file. Skill mirrors the same
 * shape in `skill/skill-service.ts` by intent — agent and skill are
 * independent kinds with no shared domain methods.
 *
 * The agent-only `disableByUser` / `enableByUser` methods live here
 * (skills cannot be user-disabled).
 */
export interface AgentServiceOpts {
  readonly repo: AgentRepository;
  readonly fetcher: AgentFetcher;
  readonly siblings?: {
    readonly skills?: SkillRepository;
    readonly mcps?: McpRepository;
  };
}

export class AgentService {
  private readonly repo: AgentRepository;
  private readonly fetcher: AgentFetcher;
  private readonly siblings: {
    readonly skills?: SkillRepository;
    readonly mcps?: McpRepository;
  };

  constructor(opts: AgentServiceOpts) {
    this.repo = opts.repo;
    this.fetcher = opts.fetcher;
    this.siblings = opts.siblings ?? {};
  }

  resolve(origin: string, opts: AgentResolveOpts = {}): Promise<AgentResolvePlan> {
    return resolveAgentOrigin({
      origin,
      fetcher: this.fetcher,
      repo: this.repo,
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    });
  }

  async install(planOrOrigin: AgentResolvedNode | string): Promise<AgentEntity> {
    let node: AgentResolvedNode;
    if (typeof planOrOrigin === "string") {
      const plan = await this.resolve(planOrOrigin);
      if (plan.conflict !== null) throw conflictToError(plan.conflict);
      if (plan.node === null) {
        throw new Error("unreachable: resolve returned neither node nor conflict");
      }
      node = plan.node;
    } else {
      node = planOrOrigin;
    }

    const files = new Map<string, Buffer>();
    let anchorContent: string | null = null;
    for await (const file of this.fetcher.fetchTree(node.origin)) {
      files.set(file.relPath, file.content);
      if (file.relPath === "AGENTS.md") {
        anchorContent = file.content.toString("utf8");
      }
    }
    if (anchorContent === null) {
      throw new AgentFrontmatterError(
        `install:${node.origin}`,
        "fetcher yielded no AGENTS.md (agent must contain a top-level AGENTS.md)",
      );
    }

    let entity = AgentEntity.create(
      anchorContent,
      Origin.parse(safeNormalize(node.origin)),
      `install:${node.origin}`,
    );

    if (entity.version !== node.version) {
      throw new AgentPlanStaleError(node.fqn, node.origin, node.version, entity.version);
    }

    const existing = await this.repo.findById(entity.fqn);
    if (existing !== undefined && !sameOrigin(existing.origin, entity.origin)) {
      throw new AgentOriginConflictError(entity.fqn, existing.origin, entity.origin);
    }

    if (existing !== undefined) {
      const prereqsAck =
        (existing.prereqs ?? "") === (entity.prereqs ?? "")
          ? existing.prereqsAck
          : entity.prereqsAck;
      entity = entity.withState({ prereqsAck, disabledByUser: existing.disabledByUser });
    }

    const resolvedDeps = await this.resolveDepOrigins(entity.fqn, entity.depsRefs);
    await this.repo.insert(entity, files, resolvedDeps);
    return (await this.repo.findById(entity.fqn)) ?? entity;
  }

  async get(fqn: string): Promise<AgentEntity | null> {
    return (await this.repo.findById(fqn)) ?? null;
  }

  async list(): Promise<AgentEntity[]> {
    return this.repo.findAll();
  }

  async has(fqn: string): Promise<boolean> {
    return (await this.repo.findById(fqn)) !== undefined;
  }

  async getByOrigin(origin: string): Promise<AgentEntity | null> {
    return (await this.repo.findByOrigin(safeNormalize(origin))) ?? null;
  }

  streamFiles(fqn: string): AsyncIterable<AgentFile> {
    return this.repo.streamFiles(fqn);
  }

  async getAnchor(fqn: string): Promise<string> {
    return this.repo.getAnchor(fqn);
  }

  async delete(fqn: string): Promise<void> {
    const existing = await this.repo.findById(fqn);
    if (existing === undefined) throw new AgentNotFoundError(fqn);
    await this.repo.delete(fqn);
  }

  async acknowledgePrereqs(fqn: string): Promise<AgentEntity> {
    const existing = await this.repo.findById(fqn);
    if (existing === undefined) throw new AgentNotFoundError(fqn);
    if (!existing.prereqsAck) {
      await this.repo.setFlags(fqn, { prereqsAck: true });
    }
    const updated = await this.repo.findById(fqn);
    if (updated === undefined) throw new AgentNotFoundError(fqn);
    return updated;
  }

  async disableByUser(fqn: string): Promise<AgentEntity> {
    return this.setUserDisabled(fqn, true);
  }

  async enableByUser(fqn: string): Promise<AgentEntity> {
    return this.setUserDisabled(fqn, false);
  }

  private async setUserDisabled(fqn: string, value: boolean): Promise<AgentEntity> {
    const existing = await this.repo.findById(fqn);
    if (existing === undefined) throw new AgentNotFoundError(fqn);
    if (existing.disabledByUser !== value) {
      await this.repo.setFlags(fqn, { disabledByUser: value });
    }
    const updated = await this.repo.findById(fqn);
    if (updated === undefined) throw new AgentNotFoundError(fqn);
    return updated;
  }

  async setFlags(
    fqn: string,
    flags: { prereqsAck?: boolean; disabledByUser?: boolean },
  ): Promise<void> {
    await this.repo.setFlags(fqn, flags);
  }

  close(): void {
    this.repo.close?.();
  }

  /**
   * Resolve frontmatter dep origins to local sibling fqns.
   *
   * Throws `AgentUnresolvedDepError` if any origin doesn't match an
   * installed sibling — this enforces the fqn↔origin 1:1 invariant
   * (every declared dep MUST have a corresponding catalog row).
   * `parentFqn` is included in the error for diagnostics only.
   *
   * Inlined per kind (agent owns this lookup loop) — no shared
   * sibling-lookup helper exists, by design.
   *
   * Agent→agent edges resolve against `this.repo` (the agent owns
   * its own self-reference table; there is no separate "agents
   * sibling repo" — agents resolve via the same `AgentRepository`).
   */
  private async resolveDepOrigins(
    parentFqn: string,
    refs: {
      readonly skills: readonly string[];
      readonly mcps: readonly string[];
      readonly agents: readonly string[];
    },
  ): Promise<{ skills: string[]; mcps: string[]; agents: string[] }> {
    const skills: string[] = [];
    if (this.siblings.skills !== undefined) {
      const repo = this.siblings.skills;
      for (const origin of refs.skills) {
        const sib = await repo.findByOrigin(safeNormalize(origin));
        if (sib === undefined) throw new AgentUnresolvedDepError(parentFqn, "skill", origin);
        skills.push(sib.fqn);
      }
    }
    const mcps: string[] = [];
    if (this.siblings.mcps !== undefined) {
      const repo = this.siblings.mcps;
      for (const origin of refs.mcps) {
        const sib = await repo.findByOrigin(safeNormalize(origin));
        if (sib === undefined) throw new AgentUnresolvedDepError(parentFqn, "mcp", origin);
        mcps.push(sib.fqn);
      }
    }
    const agents: string[] = [];
    for (const origin of refs.agents) {
      const sib = await this.repo.findByOrigin(safeNormalize(origin));
      if (sib === undefined) throw new AgentUnresolvedDepError(parentFqn, "agent", origin);
      agents.push(sib.fqn);
    }
    return { skills, mcps, agents };
  }
}

function conflictToError(c: AgentResolveConflict): Error {
  if (c.reason.kind === "fetch-failed" || c.reason.kind === "parse-failed") {
    return c.reason.cause instanceof Error
      ? c.reason.cause
      : new Error(`agent resolve failed: ${c.reason.kind}`);
  }
  if (c.reason.kind === "origin-conflict" && c.fqn !== null) {
    return new AgentOriginConflictError(c.fqn, c.reason.existingOrigin, c.origin);
  }
  return new Error(`agent resolve conflict: ${JSON.stringify(c.reason)}`);
}
