import {
  PlanStaleError,
  SkillNotFoundError,
  SkillOriginConflictError,
} from "../contract/skill.errors.js";
import { normaliseOriginDeps, type OriginDeps } from "../domain/catalog.dep-keys.js";
import { Origin } from "../domain/origin.js";
import { SkillEntity } from "../domain/skill.entity.js";
import { SkillFrontmatterError, SkillUnresolvedDepError } from "../domain/skill.errors.js";
import { SKILL_DEP_SPECS, type SkillDepKind } from "../domain/skill.frontmatter.js";
import type { EntryFile } from "../fetcher/index.js";
import { safeNormalize, sameOrigin } from "../fetcher/origin.js";
import type { McpRepository } from "../persistence/mcp.repository.js";
import type { SkillFile, SkillRepository } from "../persistence/skill.repository.js";

export interface SkillFetcher {
  fetchAnchor(origin: string): Promise<string>;
  fetchTree(origin: string): AsyncIterable<EntryFile>;
}

// Per-kind resolve types. Mirrored from the agent side by intent —
// agent and skill are independent kinds and intentionally don't share
// a base class or shared resolve-types module. Duplication beats
// domain coupling: the moment either kind grows a kind-specific field
// the shared abstraction has to either widen or fork — both worse
// than copying ~30 LOC.

export type SkillResolveEvent =
  | { type: "fetching"; origin: string }
  | { type: "fetched"; origin: string; fqn: string }
  | { type: "alreadyInstalled"; fqn: string }
  | { type: "failed"; origin: string; error: unknown };

export interface SkillResolveOpts {
  onProgress?: (event: SkillResolveEvent) => void;
}

export interface SkillResolvedNode {
  readonly fqn: string;
  readonly origin: string;
  readonly anchorContent: string;
  readonly version: string;
  readonly depsRefs: OriginDeps<SkillDepKind>;
}

export type SkillResolveConflict = {
  readonly origin: string;
  readonly fqn: string | null;
  readonly reason:
    | { kind: "fetch-failed"; cause: unknown }
    | { kind: "parse-failed"; cause: unknown }
    | { kind: "origin-conflict"; existingOrigin: string };
};

export interface SkillResolvePlan {
  readonly node: SkillResolvedNode | null;
  readonly conflict: SkillResolveConflict | null;
}

/**
 * Pure resolve workflow: fetch the anchor bytes, parse them into a
 * `SkillEntity`, check for origin conflicts against the local repo,
 * build the resolved-node payload. Returns `{node, conflict}` — the
 * caller maps the conflict to `SkillOriginConflictError`.
 *
 * Mirrors `resolveAgentOrigin` in `agent/agent-service.ts` by intent;
 * the two copies are independent and must NOT be re-factored into a
 * shared helper.
 */
async function resolveSkillOrigin(opts: {
  readonly origin: string;
  readonly fetcher: SkillFetcher;
  readonly repo: SkillRepository;
  readonly onProgress?: (event: SkillResolveEvent) => void;
}): Promise<SkillResolvePlan> {
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

  let entity: SkillEntity;
  try {
    entity = SkillEntity.create(
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

  const depsRefs = normaliseOriginDeps(SKILL_DEP_SPECS, entity.depsRefs);
  const node: SkillResolvedNode = {
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
 * Application-layer service for skill operations. Skill owns its
 * resolve workflow inline (see `resolveSkillOrigin` above) plus its
 * resolve-result types declared in this file. Agent mirrors the same
 * shape in `agent/agent-service.ts` by intent — agent and skill are
 * independent kinds with no shared domain methods.
 *
 * Skill dep resolution looks up sibling skills in THIS repo (skills
 * may depend on other skills); MCP deps go through the injected
 * `siblings.mcps` repo. Skills cannot be user-disabled — no
 * `disable/enable` methods live here.
 */
export interface SkillServiceOpts {
  readonly repo: SkillRepository;
  readonly fetcher: SkillFetcher;
  readonly siblings?: {
    readonly mcps?: McpRepository;
  };
}

export class SkillService {
  private readonly repo: SkillRepository;
  private readonly fetcher: SkillFetcher;
  private readonly siblings: {
    readonly mcps?: McpRepository;
  };

  constructor(opts: SkillServiceOpts) {
    this.repo = opts.repo;
    this.fetcher = opts.fetcher;
    this.siblings = opts.siblings ?? {};
  }

  resolve(origin: string, opts: SkillResolveOpts = {}): Promise<SkillResolvePlan> {
    return resolveSkillOrigin({
      origin,
      fetcher: this.fetcher,
      repo: this.repo,
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    });
  }

  async install(planOrOrigin: SkillResolvedNode | string): Promise<SkillEntity> {
    let node: SkillResolvedNode;
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
      if (file.relPath === "SKILL.md") {
        anchorContent = file.content.toString("utf8");
      }
    }
    if (anchorContent === null) {
      throw new SkillFrontmatterError(
        `install:${node.origin}`,
        "fetcher yielded no SKILL.md (skill must contain a top-level SKILL.md)",
      );
    }

    let entity = SkillEntity.create(
      anchorContent,
      Origin.parse(safeNormalize(node.origin)),
      `install:${node.origin}`,
    );

    if (entity.version !== node.version) {
      throw new PlanStaleError(node.fqn, node.origin, node.version, entity.version);
    }

    const existing = await this.repo.findById(entity.fqn);
    if (existing !== undefined && !sameOrigin(existing.origin, entity.origin)) {
      throw new SkillOriginConflictError(entity.fqn, existing.origin, entity.origin);
    }

    if (existing !== undefined) {
      const prereqsAck =
        (existing.prereqs ?? "") === (entity.prereqs ?? "")
          ? existing.prereqsAck
          : entity.prereqsAck;
      entity = entity.withState({ prereqsAck });
    }

    const resolvedDeps = await this.resolveDepOrigins(entity.fqn, entity.depsRefs);
    await this.repo.insert(entity, files, resolvedDeps);
    return (await this.repo.findById(entity.fqn)) ?? entity;
  }

  async get(fqn: string): Promise<SkillEntity | null> {
    return (await this.repo.findById(fqn)) ?? null;
  }

  async list(): Promise<SkillEntity[]> {
    return this.repo.findAll();
  }

  async has(fqn: string): Promise<boolean> {
    return (await this.repo.findById(fqn)) !== undefined;
  }

  async getByOrigin(origin: string): Promise<SkillEntity | null> {
    return (await this.repo.findByOrigin(safeNormalize(origin))) ?? null;
  }

  streamFiles(fqn: string): AsyncIterable<SkillFile> {
    return this.repo.streamFiles(fqn);
  }

  async getAnchor(fqn: string): Promise<string> {
    return this.repo.getAnchor(fqn);
  }

  async delete(fqn: string): Promise<void> {
    const existing = await this.repo.findById(fqn);
    if (existing === undefined) throw new SkillNotFoundError(fqn);
    await this.repo.delete(fqn);
  }

  async acknowledgePrereqs(fqn: string): Promise<SkillEntity> {
    const existing = await this.repo.findById(fqn);
    if (existing === undefined) throw new SkillNotFoundError(fqn);
    if (!existing.prereqsAck) {
      await this.repo.setFlags(fqn, { prereqsAck: true });
    }
    const updated = await this.repo.findById(fqn);
    if (updated === undefined) throw new SkillNotFoundError(fqn);
    return updated;
  }

  async setFlags(fqn: string, flags: { prereqsAck?: boolean }): Promise<void> {
    await this.repo.setFlags(fqn, flags);
  }

  close(): void {
    this.repo.close?.();
  }

  /**
   * Resolve frontmatter dep origins to local sibling fqns.
   *
   * Throws `SkillUnresolvedDepError` if any origin doesn't match an
   * installed sibling — this enforces the fqn↔origin 1:1 invariant
   * (every declared dep MUST have a corresponding catalog row).
   * `parentFqn` is included in the error for diagnostics only.
   *
   * Inlined per kind (skill owns this lookup loop) — the skill bucket
   * points at THIS service's repo, not an injected sibling, so the
   * loop reads cleanly without indirection.
   */
  private async resolveDepOrigins(
    parentFqn: string,
    refs: {
      readonly skills: readonly string[];
      readonly mcps: readonly string[];
    },
  ): Promise<{ skills: string[]; mcps: string[] }> {
    const skillFqns: string[] = [];
    const mcpFqns: string[] = [];
    for (const origin of refs.skills) {
      const sib = await this.repo.findByOrigin(safeNormalize(origin));
      if (sib === undefined) throw new SkillUnresolvedDepError(parentFqn, "skill", origin);
      skillFqns.push(sib.fqn);
    }
    if (this.siblings.mcps !== undefined) {
      for (const origin of refs.mcps) {
        const sib = await this.siblings.mcps.findByOrigin(safeNormalize(origin));
        if (sib === undefined) throw new SkillUnresolvedDepError(parentFqn, "mcp", origin);
        mcpFqns.push(sib.fqn);
      }
    }
    return { skills: skillFqns, mcps: mcpFqns };
  }
}

function conflictToError(c: SkillResolveConflict): Error {
  if (c.reason.kind === "fetch-failed" || c.reason.kind === "parse-failed") {
    return c.reason.cause instanceof Error
      ? c.reason.cause
      : new Error(`skill resolve failed: ${c.reason.kind}`);
  }
  if (c.reason.kind === "origin-conflict" && c.fqn !== null) {
    return new SkillOriginConflictError(c.fqn, c.reason.existingOrigin, c.origin);
  }
  return new Error(`skill resolve conflict: ${JSON.stringify(c.reason)}`);
}
