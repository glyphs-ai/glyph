/**
 * Use case: resolve a reconciliation plan for a root entry. Install and
 * sync are the SAME operation — reconcile a root origin's upstream tree
 * against what's installed locally. The caller passes either an `origin`
 * (not-yet-installed root, the install path) or an `fqn` (already-installed
 * root, the sync path, resolved to its origin first); the algorithm is
 * identical from there: fetch upstream, fetch local, diff by version/spec,
 * flag origin conflicts, compute orphans.
 *
 * Local reads go through the read-side `CatalogQueries` seam; the write
 * repositories are never touched here. Owns `CatalogPlan` (its Response);
 * apply consumes this Response verbatim.
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AgentNotFound, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { CatalogKindSchema } from "../../domain/catalog-kind.js";
import type { McpNotFound } from "../../domain/mcp-repository.js";
import { RegistryOriginSchema } from "../../domain/registry-origin.js";
import type { SkillNotFound } from "../../domain/skill-repository.js";
import type { Db } from "../../infrastructure/drizzle/catalog-db.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { selectAgentByFqn, selectAgentByOrigin, selectAllAgents } from "../agent/agent-reads.js";
import { selectMcpByFqn, selectMcpByOrigin } from "../mcp/mcp-reads.js";
import { selectAllSkills, selectSkillByFqn, selectSkillByOrigin } from "../skill/skill-reads.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import {
  type CatalogConflict,
  ConflictSchema,
  type ResolvedGraph,
  type ResolvedNode,
} from "./dependency-graph.js";
import type { GetTreeUseCase } from "./get-tree.js";
import type { GetUpstreamTreeUseCase } from "./get-upstream-tree.js";

const resolvePlanDependencyRefs = z.object({
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  agents: z.array(z.string()),
});

const resolvePlanNode = z.object({
  kind: CatalogKindSchema,
  origin: z.string(),
  fqn: z.string(),
  disposition: z.enum(["new", "will-sync", "up-to-date", "identity-changed"]),
  wasAlreadyInstalled: z.boolean(),
  /** Dep origins (flattened skills+mcps+agents) — drives apply poisoning. */
  deps: z.array(z.string()),
  /** Dep origins by kind; apply resolves these to installed fqns before persisting. */
  dependencyRefs: resolvePlanDependencyRefs,
  /** Manifest version (skill/agent semver; "" for mcp). Carried from resolve so apply skips re-fetch. */
  version: z.string(),
  /** Manifest content (mcp spec; "" for skill/agent). Carried from resolve so apply skips re-fetch. */
  content: z.string(),
});
export type PlanNode = z.infer<typeof resolvePlanNode>;

const resolvePlanOrphan = z.object({
  kind: z.enum(["skill", "mcp"]),
  fqn: z.string(),
  origin: z.string(),
});
export type Orphan = z.infer<typeof resolvePlanOrphan>;

const resolvePlanIdentityChange = z.object({
  kind: CatalogKindSchema,
  oldFqn: z.string(),
  newFqn: z.string(),
});
export type IdentityChange = z.infer<typeof resolvePlanIdentityChange>;

export const ResolvePlanRequestSchema = z
  .object({
    kind: CatalogKindSchema,
    origin: RegistryOriginSchema.optional(),
    fqn: z.string().optional(),
  })
  .refine((r) => (r.origin === undefined) !== (r.fqn === undefined), {
    message: "exactly one of `origin` or `fqn` must be provided",
  });
export type ResolvePlanRequest = z.infer<typeof ResolvePlanRequestSchema>;

export const ResolvePlanResponseSchema = z.object({
  rootOrigin: z.string(),
  rootKind: CatalogKindSchema,
  toInstall: z.array(resolvePlanNode),
  alreadyInstalled: z.array(resolvePlanNode),
  conflicts: z.array(ConflictSchema),
  orphans: z.array(resolvePlanOrphan),
  identityChange: resolvePlanIdentityChange.optional(),
  upToDate: z.boolean(),
  /** True when the root origin is already installed (install path only). The
   *  caller should direct the user to sync instead of install. When set, the
   *  dep tree was NOT resolved (skipped for performance). */
  rootAlreadyInstalled: z.boolean().optional(),
});
export type ResolvePlanResponse = z.infer<typeof ResolvePlanResponseSchema>;
/** Wire alias — the plan DTO consumers and `apply-plan` pass around. */
export type CatalogPlan = ResolvePlanResponse;

export type ResolvePlanError = SkillNotFound | AgentNotFound | McpNotFound | DatabaseUnavailable;

export interface ResolvePlanDeps {
  readonly getUpstreamTree: GetUpstreamTreeUseCase;
  readonly getTree: GetTreeUseCase;
  readonly queries: CatalogQueries;
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
    version: n.version,
    content: n.content,
  };
}

function sameVersion(a: ResolvedNode, b: ResolvedNode): boolean {
  if (a.kind !== b.kind || a.fqn !== b.fqn) return false;
  return a.kind === "mcp" ? a.content === b.content : a.version === b.version;
}

function indexByOrigin(graph: ResolvedGraph): Map<string, ResolvedNode> {
  return new Map(graph.nodes.map((n) => [n.origin, n]));
}

/** Installed origin for a dependency fqn, or `undefined` when not installed. */
function originForFqn(db: Db, kind: CatalogKind, fqn: string): string | undefined {
  if (kind === "skill") return selectSkillByFqn(db, fqn)?.origin;
  if (kind === "agent") return selectAgentByFqn(db, fqn)?.origin;
  return selectMcpByFqn(db, fqn)?.origin;
}

export class ResolvePlanUseCase
  implements UseCase<ResolvePlanRequest, ResolvePlanResponse, ResolvePlanError>
{
  constructor(private readonly deps: ResolvePlanDeps) {}

  execute(request: ResolvePlanRequest): UseCaseResult<ResolvePlanResponse, ResolvePlanError> {
    const parsed = ResolvePlanRequestSchema.parse(request);
    // Install path (origin provided): if the root is already installed,
    // short-circuit without resolving the dep tree — tell the caller to use
    // sync instead. This avoids the full upstream network walk for large
    // agents when the user accidentally re-installs an existing entry.
    if (parsed.origin !== undefined) {
      return this.deps.queries
        .query((db) => this.isOriginInstalled(db, parsed.kind, parsed.origin!))
        .andThen((installed): ResultAsync<ResolvePlanResponse, ResolvePlanError> => {
          if (installed) {
            return okAsync({
              rootOrigin: parsed.origin!,
              rootKind: parsed.kind,
              toInstall: [],
              alreadyInstalled: [],
              conflicts: [],
              orphans: [],
              upToDate: true,
              rootAlreadyInstalled: true,
            });
          }
          return ResultAsync.fromSafePromise(this.build(parsed.kind, parsed.origin!));
        });
    }
    return this.rootOrigin(parsed).andThen((origin) =>
      ResultAsync.fromSafePromise(this.build(parsed.kind, origin)),
    );
  }

  /**
   * The root origin to reconcile. When called with an `origin` (install
   * path) it's used directly; when called with an `fqn` (sync path) the
   * installed entry is looked up to recover its origin.
   */
  private rootOrigin(request: ResolvePlanRequest): ResultAsync<string, ResolvePlanError> {
    if (request.origin !== undefined) return okAsync(request.origin);
    const raw = request.fqn ?? "";
    const kind = request.kind;
    return this.deps.queries
      .query((db) => originForFqn(db, kind, raw))
      .andThen((origin): ResultAsync<string, ResolvePlanError> => {
        if (origin !== undefined) return okAsync(origin);
        if (kind === "skill")
          return errAsync<string, ResolvePlanError>({ type: "SkillNotFound", fqn: raw });
        if (kind === "agent")
          return errAsync<string, ResolvePlanError>({ type: "AgentNotFound", fqn: raw });
        return errAsync<string, ResolvePlanError>({ type: "McpNotFound", fqn: raw });
      });
  }

  /** Check if an origin is already installed locally (any kind). */
  private isOriginInstalled(db: Db, kind: CatalogKind, origin: string): boolean {
    if (kind === "skill") return selectSkillByOrigin(db, origin) !== undefined;
    if (kind === "agent") return selectAgentByOrigin(db, origin) !== undefined;
    return selectMcpByOrigin(db, origin) !== undefined;
  }

  private async build(kind: CatalogKind, origin: string): Promise<ResolvePlanResponse> {
    const fetched = (await this.deps.getUpstreamTree.execute({ kind, origin }))._unsafeUnwrap();
    // A driver fault while flagging degrades to the unflagged graph (no
    // conflicts surfaced).
    const upstream = (
      await this.deps.queries.query((db) => this.flagOriginConflicts(db, fetched))
    ).unwrapOr(fetched);
    // getTree only fails on DatabaseUnavailable; an empty local graph (the
    // install case, nothing installed yet) resolves to ok with no nodes.
    const local = (await this.deps.getTree.execute({ origin })).unwrapOr({
      nodes: [],
      conflicts: [],
    });
    // Augment the tree-walked local graph with upstream deps that happen to be
    // installed elsewhere (e.g. skillB installed as dep of agentC, now also
    // needed by agentA). Without this, the diff sees them as "new".
    const augmented = (
      await this.deps.queries.query((db) => this.augmentWithInstalled(db, upstream, local))
    ).unwrapOr(local);
    const reverseDepIndex = (
      await this.deps.queries.query((db) => this.reverseDepIndex(db, origin))
    ).unwrapOr(new Set<string>());
    const diff = this.diff(upstream, augmented, origin, kind, reverseDepIndex);
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

  /** Flag upstream nodes whose fqn is installed under a DIFFERENT origin. */
  private flagOriginConflicts(db: Db, graph: ResolvedGraph): ResolvedGraph {
    const conflicts: CatalogConflict[] = [...graph.conflicts];
    const nodes: ResolvedNode[] = [];
    for (const node of graph.nodes) {
      const existing =
        node.kind === "skill"
          ? selectSkillByFqn(db, node.fqn)
          : node.kind === "agent"
            ? selectAgentByFqn(db, node.fqn)
            : selectMcpByFqn(db, node.fqn);
      if (existing === undefined || existing.origin === node.origin) {
        nodes.push(node);
        continue;
      }
      conflicts.push({
        kind: node.kind,
        origin: node.origin,
        fqn: node.fqn,
        reason: { kind: "origin-conflict", existingOrigin: existing.origin },
      });
    }
    return { nodes, conflicts };
  }

  /** Origins referenced by any installed entry OTHER than the root. */
  private reverseDepIndex(db: Db, rootOrigin: string): Set<string> {
    const referenced = new Set<string>();
    const addOrigins = (kind: CatalogKind, fqns: readonly string[]): void => {
      for (const fqn of fqns) {
        const origin = originForFqn(db, kind, fqn);
        if (origin !== undefined) referenced.add(origin);
      }
    };
    for (const skill of selectAllSkills(db)) {
      if (skill.origin === rootOrigin) continue;
      addOrigins("skill", skill.dependencyRefs.skills);
      addOrigins("mcp", skill.dependencyRefs.mcps);
    }
    for (const agent of selectAllAgents(db)) {
      if (agent.origin === rootOrigin) continue;
      addOrigins("skill", agent.dependencyRefs.skills);
      addOrigins("mcp", agent.dependencyRefs.mcps);
      addOrigins("agent", agent.dependencyRefs.agents);
    }
    return referenced;
  }

  /**
   * For each upstream node not already in the local tree, check if it's
   * installed anywhere in the catalog. If so, add it to the local graph so
   * the diff correctly marks it as "up-to-date" or "will-sync" instead of
   * "new". This handles shared deps (e.g. skillB installed via agentC, now
   * also required by agentA).
   */
  private augmentWithInstalled(
    db: Db,
    upstream: ResolvedGraph,
    local: ResolvedGraph,
  ): ResolvedGraph {
    const localOrigins = new Set(local.nodes.map((n) => n.origin));
    const extra: ResolvedNode[] = [];
    for (const node of upstream.nodes) {
      if (localOrigins.has(node.origin)) continue;
      const installed = this.lookupInstalled(db, node.kind, node.origin);
      if (installed) extra.push(installed);
    }
    if (extra.length === 0) return local;
    return { nodes: [...local.nodes, ...extra], conflicts: local.conflicts };
  }

  private lookupInstalled(db: Db, kind: CatalogKind, origin: string): ResolvedNode | null {
    if (kind === "skill") {
      const s = selectSkillByOrigin(db, origin);
      if (s)
        return {
          kind: "skill",
          origin,
          fqn: s.fqn,
          version: s.version,
          content: "",
          dependencyRefs: { skills: [], mcps: [], agents: [] },
        };
    } else if (kind === "agent") {
      const a = selectAgentByOrigin(db, origin);
      if (a)
        return {
          kind: "agent",
          origin,
          fqn: a.fqn,
          version: a.version,
          content: "",
          dependencyRefs: { skills: [], mcps: [], agents: [] },
        };
    } else {
      const m = selectMcpByOrigin(db, origin);
      if (m)
        return {
          kind: "mcp",
          origin,
          fqn: m.fqn,
          version: "",
          content: m.spec,
          dependencyRefs: { skills: [], mcps: [], agents: [] },
        };
    }
    return null;
  }
}
