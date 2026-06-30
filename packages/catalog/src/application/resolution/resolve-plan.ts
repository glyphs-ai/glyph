/**
 * Use case: resolve a reconciliation plan for a root entry. Install and
 * sync are the SAME operation — reconcile a root origin's upstream tree
 * against what's installed locally. The caller passes either an `origin`
 * (not-yet-installed root, the install path) or an `fqn` (already-installed
 * root, the sync path, resolved to its origin first); the algorithm is
 * identical from there: fetch upstream, fetch local, diff by version/spec,
 * flag origin conflicts, compute orphans.
 *
 * Owns `CatalogPlan` (its Response). Apply consumes this Response verbatim.
 */

import { errAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { type AgentFqn, AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import { CatalogKindSchema } from "../../domain/catalog-kind.js";
import { type McpFqn, McpFqnSchema } from "../../domain/mcp-fqn.js";
import type { McpNotFound, McpRepository } from "../../domain/mcp-repository.js";
import { type SkillFqn, SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import {
  type CatalogConflict,
  ConflictSchema,
  type ResolvedGraph,
  type ResolvedNode,
} from "./dependency-graph.js";
import type { GetTreeUseCase } from "./get-tree.js";
import type { GetUpstreamTreeUseCase } from "./get-upstream-tree.js";

const KindSchema = CatalogKindSchema;

const DependencyRefsSchema = z.object({
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  agents: z.array(z.string()),
});

const PlanNodeSchema = z.object({
  kind: KindSchema,
  origin: z.string(),
  fqn: z.string(),
  disposition: z.enum(["new", "will-sync", "up-to-date", "identity-changed"]),
  wasAlreadyInstalled: z.boolean(),
  /** Dep origins (flattened skills+mcps+agents) — drives apply poisoning. */
  deps: z.array(z.string()),
  /** Dep origins by kind; apply resolves these to installed fqns before persisting. */
  dependencyRefs: DependencyRefsSchema,
});
export type PlanNode = z.infer<typeof PlanNodeSchema>;

const OrphanSchema = z.object({
  kind: z.enum(["skill", "mcp"]),
  fqn: z.string(),
  origin: z.string(),
});
export type Orphan = z.infer<typeof OrphanSchema>;

const IdentityChangeSchema = z.object({
  kind: KindSchema,
  oldFqn: z.string(),
  newFqn: z.string(),
});
export type IdentityChange = z.infer<typeof IdentityChangeSchema>;

export const ResolvePlanRequestSchema = z
  .object({
    kind: KindSchema,
    origin: z.string().optional(),
    fqn: z.string().optional(),
  })
  .refine((r) => (r.origin === undefined) !== (r.fqn === undefined), {
    message: "exactly one of `origin` or `fqn` must be provided",
  });
export type ResolvePlanRequest = z.infer<typeof ResolvePlanRequestSchema>;

export const ResolvePlanResponseSchema = z.object({
  rootOrigin: z.string(),
  rootKind: KindSchema,
  toInstall: z.array(PlanNodeSchema),
  alreadyInstalled: z.array(PlanNodeSchema),
  conflicts: z.array(ConflictSchema),
  orphans: z.array(OrphanSchema),
  identityChange: IdentityChangeSchema.optional(),
  upToDate: z.boolean(),
});
export type ResolvePlanResponse = z.infer<typeof ResolvePlanResponseSchema>;
/** Wire alias — the plan DTO consumers and `apply-plan` pass around. */
export type CatalogPlan = ResolvePlanResponse;

export type ResolvePlanError = SkillNotFound | AgentNotFound | McpNotFound | DatabaseUnavailable;

export interface ResolvePlanDeps {
  readonly getUpstreamTree: GetUpstreamTreeUseCase;
  readonly getTree: GetTreeUseCase;
  readonly repos: {
    skill: SkillRepository;
    agent: AgentRepository;
    mcp: McpRepository;
  };
}

type CatalogKind = "skill" | "agent" | "mcp";

interface Diff {
  toInstall: PlanNode[];
  alreadyInstalled: PlanNode[];
  identityChange?: IdentityChange;
  orphans: Orphan[];
}

function planNode(n: ResolvedNode, disposition: PlanNode["disposition"], was: boolean): PlanNode {
  return {
    kind: n.kind,
    origin: n.origin,
    fqn: n.fqn,
    disposition,
    wasAlreadyInstalled: was,
    deps: [...n.dependencyRefs.skills, ...n.dependencyRefs.mcps, ...n.dependencyRefs.agents],
    dependencyRefs: n.dependencyRefs,
  };
}

function sameVersion(a: ResolvedNode, b: ResolvedNode): boolean {
  if (a.kind !== b.kind || a.fqn !== b.fqn) return false;
  return a.kind === "mcp" ? a.content === b.content : a.version === b.version;
}

function indexByOrigin(graph: ResolvedGraph): Map<string, ResolvedNode> {
  return new Map(graph.nodes.map((n) => [n.origin, n]));
}

export class ResolvePlanUseCase
  implements UseCase<ResolvePlanRequest, ResolvePlanResponse, ResolvePlanError>
{
  constructor(private readonly deps: ResolvePlanDeps) {}

  execute(request: ResolvePlanRequest): UseCaseResult<ResolvePlanResponse, ResolvePlanError> {
    return this.rootOrigin(request).andThen((origin) =>
      ResultAsync.fromSafePromise(this.build(request.kind, origin)),
    );
  }

  /**
   * The root origin to reconcile. When called with an `origin` (install
   * path) it's used directly; when called with an `fqn` (sync path) the
   * installed entry is looked up to recover its origin.
   */
  private rootOrigin(request: ResolvePlanRequest): ResultAsync<string, ResolvePlanError> {
    if (request.origin !== undefined)
      return ResultAsync.fromSafePromise(Promise.resolve(request.origin));
    const raw = request.fqn ?? "";
    if (request.kind === "skill") {
      const fqn = SkillFqnSchema.safeParse(raw);
      if (!fqn.success)
        return errAsync<string, ResolvePlanError>({ type: "SkillNotFound", fqn: raw });
      return this.deps.repos.skill.get(fqn.data).map((skill) => skill.origin);
    }
    if (request.kind === "agent") {
      const fqn = AgentFqnSchema.safeParse(raw);
      if (!fqn.success)
        return errAsync<string, ResolvePlanError>({ type: "AgentNotFound", fqn: raw });
      return this.deps.repos.agent.get(fqn.data).map((agent) => agent.origin);
    }
    const fqn = McpFqnSchema.safeParse(raw);
    if (!fqn.success) return errAsync<string, ResolvePlanError>({ type: "McpNotFound", fqn: raw });
    return this.deps.repos.mcp.get(fqn.data).map((mcp) => mcp.origin);
  }

  private async build(kind: CatalogKind, origin: string): Promise<ResolvePlanResponse> {
    const fetched = (await this.deps.getUpstreamTree.execute({ kind, origin }))._unsafeUnwrap();
    const upstream = await this.flagOriginConflicts(fetched);
    // getTree only fails on DatabaseUnavailable; an empty local graph (the
    // install case, nothing installed yet) resolves to ok with no nodes.
    const local = (await this.deps.getTree.execute({ origin })).unwrapOr({
      nodes: [],
      conflicts: [],
    });
    const reverseDepIndex = await this.reverseDepIndex(origin);
    const diff = this.diff(upstream, local, origin, kind, reverseDepIndex);
    const settled =
      diff.toInstall.length === 0 &&
      upstream.conflicts.length === 0 &&
      diff.orphans.length === 0 &&
      diff.identityChange === undefined;
    return {
      rootOrigin: origin,
      rootKind: kind,
      toInstall: diff.toInstall,
      alreadyInstalled: diff.alreadyInstalled,
      conflicts: upstream.conflicts,
      orphans: diff.orphans,
      ...(diff.identityChange ? { identityChange: diff.identityChange } : {}),
      upToDate: settled,
    };
  }

  private diff(
    upstream: ResolvedGraph,
    local: ResolvedGraph,
    rootOrigin: string,
    rootKind: CatalogKind,
    reverseDepIndex: ReadonlySet<string>,
  ): Diff {
    const up = indexByOrigin(upstream);
    const lo = indexByOrigin(local);

    // Identity change at root short-circuits so the caller can confirm the
    // root replacement before resolving its dependencies.
    const u = up.get(rootOrigin);
    const l = lo.get(rootOrigin);
    if (u && l && u.kind === l.kind && u.fqn !== l.fqn) {
      return {
        toInstall: [planNode(u, "identity-changed", true)],
        alreadyInstalled: [],
        identityChange: { kind: u.kind, oldFqn: l.fqn, newFqn: u.fqn },
        orphans: [],
      };
    }

    const toInstall: PlanNode[] = [];
    const alreadyInstalled: PlanNode[] = [];
    for (const [nodeOrigin, upNode] of up) {
      const loNode = lo.get(nodeOrigin);
      if (loNode && sameVersion(upNode, loNode)) {
        alreadyInstalled.push(planNode(upNode, "up-to-date", true));
        continue;
      }
      const was = loNode !== undefined;
      toInstall.push(planNode(upNode, was ? "will-sync" : "new", was));
    }

    // Root promotes up-to-date → will-sync when any dep churned, so a sync
    // always re-touches the root entry the user asked about.
    const rootIdx = alreadyInstalled.findIndex((n) => n.origin === rootOrigin);
    if (rootIdx >= 0 && toInstall.length > 0) {
      const root = alreadyInstalled[rootIdx]!;
      alreadyInstalled.splice(rootIdx, 1);
      toInstall.push({ ...root, disposition: "will-sync" });
    }

    // Orphans: local-but-not-upstream skill/mcp that no other installed
    // entry references. Agents are never orphaned (top-level), and an mcp
    // root has no dep tree to orphan.
    const orphans: Orphan[] = [];
    if (rootKind !== "mcp") {
      for (const [nodeOrigin, loNode] of lo) {
        if (nodeOrigin === rootOrigin || up.has(nodeOrigin)) continue;
        if (reverseDepIndex.has(nodeOrigin) || loNode.kind === "agent") continue;
        orphans.push({ kind: loNode.kind, fqn: loNode.fqn, origin: nodeOrigin });
      }
    }

    return { toInstall, alreadyInstalled, orphans };
  }

  private async flagOriginConflicts(graph: ResolvedGraph): Promise<ResolvedGraph> {
    const conflicts: CatalogConflict[] = [...graph.conflicts];
    const nodes: ResolvedNode[] = [];
    for (const node of graph.nodes) {
      const existing =
        node.kind === "skill"
          ? await this.deps.repos.skill.get(node.fqn as SkillFqn)
          : node.kind === "agent"
            ? await this.deps.repos.agent.get(node.fqn as AgentFqn)
            : await this.deps.repos.mcp.get(node.fqn as McpFqn);
      if (existing.isErr() || existing.value.origin === node.origin) {
        nodes.push(node);
        continue;
      }
      conflicts.push({
        kind: node.kind,
        origin: node.origin,
        fqn: node.fqn,
        reason: { kind: "origin-conflict", existingOrigin: existing.value.origin },
      });
    }
    return { nodes, conflicts };
  }

  private async reverseDepIndex(rootOrigin: string): Promise<Set<string>> {
    const referenced = new Set<string>();
    const skills = (await this.deps.repos.skill.list()).unwrapOr([]);
    const agents = (await this.deps.repos.agent.list()).unwrapOr([]);
    for (const skill of skills) {
      if (skill.origin === rootOrigin) continue;
      for (const origin of await this.skillOrigins(skill.dependencyRefs.skills))
        referenced.add(origin);
      for (const origin of await this.mcpOrigins(skill.dependencyRefs.mcps)) referenced.add(origin);
    }
    for (const agent of agents) {
      if (agent.origin === rootOrigin) continue;
      for (const origin of await this.skillOrigins(agent.dependencyRefs.skills))
        referenced.add(origin);
      for (const origin of await this.mcpOrigins(agent.dependencyRefs.mcps)) referenced.add(origin);
      for (const origin of await this.agentOrigins(agent.dependencyRefs.agents))
        referenced.add(origin);
    }
    return referenced;
  }

  private async skillOrigins(fqns: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const skill = await this.deps.repos.skill.get(fqn as SkillFqn);
      if (skill.isOk()) out.push(skill.value.origin);
    }
    return out;
  }

  private async mcpOrigins(fqns: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const mcp = await this.deps.repos.mcp.get(fqn as McpFqn);
      if (mcp.isOk()) out.push(mcp.value.origin);
    }
    return out;
  }

  private async agentOrigins(fqns: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const fqn of fqns) {
      const agent = await this.deps.repos.agent.get(fqn as AgentFqn);
      if (agent.isOk()) out.push(agent.value.origin);
    }
    return out;
  }
}
