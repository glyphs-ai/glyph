import type { CatalogPlan, CatalogPlanNode, OrphanedEntry } from "../plan-types.js";
import { buildPlanNode, nodesAreUpToDate } from "./_helpers.js";
import type { Closure } from "./types.js";

export interface DiffOptions {
  readonly rootOrigin: string;
  readonly rootKind: "skill" | "agent" | "mcp";
  readonly isSync: boolean;
  /**
   * Set of every locally-installed origin (skill+agent+mcp), used
   * to filter orphan candidates: a removed dep is only an orphan
   * if NO OTHER installed entity references it. Required for sync;
   * unused for install.
   */
  readonly globalReverseDepIndex?: ReadonlySet<string>;
}

export interface DiffResult {
  readonly toInstall: readonly CatalogPlanNode[];
  readonly alreadyInstalled: readonly CatalogPlanNode[];
  readonly identityChange?: CatalogPlan["identityChange"];
  readonly orphans: readonly OrphanedEntry[];
}

/**
 * Pure function. Compares the upstream and local
 * closures and emits the per-node disposition that drives apply.
 *
 * Identity change at root short-circuits: we emit a single
 * identity-changed root node and DROP the rest of the upstream
 * closure (its deps belong to the new identity, not the old one
 * the user is currently running). The caller is expected to
 * confirm before applying.
 *
 * Disposition rules (per non-root node, modulo identity-change):
 *   - upstream-only                              → `new`
 *   - in both, version match, fqn match          → `up-to-date`
 *   - in both, version differ                    → `will-sync`
 *   - in both, fqn differ at non-root            → not currently
 *     reachable (only root can identity-change; deps are origin-
 *     keyed so a dep's fqn changing is itself a sync-driven
 *     install of the new fqn)
 *
 * Root has one extra rule: if up-to-date but any dep ended up in
 * `toInstall` (dep churn), root is promoted to `will-sync` so the
 * user sees it as "this entry plus its deps are going to refresh".
 *
 * Orphans (sync-only): origins in local closure but NOT in upstream
 * closure, AND not referenced by any other installed entity (per
 * `globalReverseDepIndex`).
 */
export function diffClosures(upstream: Closure, local: Closure, opts: DiffOptions): DiffResult {
  // Identity change short-circuit.
  if (opts.isSync) {
    const upstreamRoot = upstream.get(opts.rootOrigin);
    const localRoot = local.get(opts.rootOrigin);
    if (
      upstreamRoot !== undefined &&
      localRoot !== undefined &&
      upstreamRoot.kind === localRoot.kind &&
      upstreamRoot.node.fqn !== localRoot.node.fqn
    ) {
      return {
        toInstall: [
          buildPlanNode(upstreamRoot, "identity-changed", true, {
            oldFqn: localRoot.node.fqn,
            newFqn: upstreamRoot.node.fqn,
          }),
        ],
        alreadyInstalled: [],
        identityChange: {
          kind: upstreamRoot.kind,
          oldFqn: localRoot.node.fqn,
          newFqn: upstreamRoot.node.fqn,
        },
        orphans: [],
      };
    }
  }

  const toInstall: CatalogPlanNode[] = [];
  const alreadyInstalled: CatalogPlanNode[] = [];

  for (const [origin, up] of upstream) {
    const wasAlreadyInstalled = up.source === "local" || local.has(origin);
    const localNode = local.get(origin);

    if (up.source === "local") {
      alreadyInstalled.push(buildPlanNode(up, undefined, true));
      continue;
    }

    if (localNode !== undefined && nodesAreUpToDate(up, localNode)) {
      alreadyInstalled.push(buildPlanNode(up, "up-to-date", true));
      continue;
    }

    const disposition: "new" | "will-sync" = wasAlreadyInstalled ? "will-sync" : "new";
    toInstall.push(buildPlanNode(up, disposition, wasAlreadyInstalled));
  }

  // Root up-to-date promotion.
  const rootIdx = alreadyInstalled.findIndex((n) => n.node.origin === opts.rootOrigin);
  if (rootIdx >= 0 && toInstall.length > 0) {
    const root = alreadyInstalled[rootIdx]!;
    if (root.disposition === "up-to-date") {
      alreadyInstalled.splice(rootIdx, 1);
      toInstall.push({ ...root, disposition: "will-sync" });
    }
  }

  // Orphan computation (sync only).
  const orphans: OrphanedEntry[] = [];
  if (opts.isSync && opts.rootKind !== "mcp" && opts.globalReverseDepIndex !== undefined) {
    for (const [origin, localNode] of local) {
      if (origin === opts.rootOrigin) continue;
      if (upstream.has(origin)) continue;
      if (opts.globalReverseDepIndex.has(origin)) continue;
      if (localNode.kind === "agent") continue;
      orphans.push({
        kind: localNode.kind,
        fqn: localNode.node.fqn,
        origin,
      });
    }
  }

  return {
    toInstall,
    alreadyInstalled,
    orphans,
  };
}
