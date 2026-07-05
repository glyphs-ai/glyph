import type { CatalogConflict, CatalogPlan, PlanNode } from "@glyphs-ai/catalog";
import { z } from "zod";

/**
 * Wire shape consumed by the dashboard's `ResolveTree` component for the
 * install + sync flows, and the projection target of {@link planToManifest}.
 *
 * Two-phase install + sync flow:
 *  - Install: dashboard POSTs `/skills/resolve` with `{ origin }` to preview,
 *    then `/skills` to commit.
 *  - Sync: dashboard POSTs `/skills/:fqn/sync/resolve` to preview the diff for
 *    an already-installed entry, then `/skills/:fqn/sync` to commit. `isSync`
 *    distinguishes the two flows so the dashboard renders orphans +
 *    identity-change banners only when they're meaningful.
 */
const CatalogKindSchema = z.enum(["skill", "agent", "mcp"]);
const DependencyKindSchema = z.enum(["skill", "mcp"]);

export const OrphanManifestEntrySchema = z.object({
  kind: DependencyKindSchema,
  fqn: z.string(),
  origin: z.string(),
});

const ManifestNodeStatusSchema = z.enum([
  "new",
  "will-sync",
  "already-installed",
  "up-to-date",
  "identity-changed",
  "would-conflict",
  "fetch-failed",
  "parse-failed",
]);

const manifestBaseNodeShape = {
  origin: z.string(),
  fqn: z.string(),
  status: ManifestNodeStatusSchema,
  dependencyOrigins: z.array(z.string()),
  identityChange: z.object({ oldFqn: z.string(), newFqn: z.string() }).optional(),
  error: z.object({ name: z.string(), message: z.string() }).optional(),
};

export const SkillManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("skill"),
  shortName: z.string(),
  scope: z.string(),
});

export const AgentManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("agent"),
  shortName: z.string(),
  scope: z.string(),
});

export const McpManifestNodeSchema = z.object({
  ...manifestBaseNodeShape,
  kind: z.literal("mcp"),
  specName: z.string(),
});

export const ResolveManifestNodeSchema = z.discriminatedUnion("kind", [
  SkillManifestNodeSchema,
  AgentManifestNodeSchema,
  McpManifestNodeSchema,
]);

export const ResolveManifestSchema = z.object({
  rootOrigin: z.string(),
  rootFqn: z.string(),
  /** True iff produced via a sync resolve, not a fresh install. */
  isSync: z.boolean(),
  /**
   * Single-use token returned only by sync resolves; the dashboard ships it
   * back on `POST .../sync` so apply replays the previewed plan. Absent on
   * install resolves (the install path takes an origin and is idempotent).
   */
  planToken: z.string().optional(),
  /** True iff a sync where root + all deps are unchanged and no orphans. */
  upToDate: z.boolean(),
  /** True when the install path's root origin is already installed; the caller
   *  should direct the user to sync instead of install. When set the dep tree
   *  was NOT resolved (skipped for performance). */
  rootAlreadyInstalled: z.boolean().optional(),
  /** Set when the upstream fqn differs from the local row's fqn. */
  identityChange: z
    .object({ kind: CatalogKindSchema, oldFqn: z.string(), newFqn: z.string() })
    .optional(),
  /** Sync-only: deps the new closure dropped that have no remaining reverse-deps. */
  orphans: z.array(OrphanManifestEntrySchema),
  nodes: z.array(ResolveManifestNodeSchema),
});

export type ResolveManifest = z.infer<typeof ResolveManifestSchema>;
export type ResolveManifestNode = z.infer<typeof ResolveManifestNodeSchema>;
export type OrphanManifestEntry = z.infer<typeof OrphanManifestEntrySchema>;

type NodeStatus = ResolveManifestNode["status"];

export function planToManifest(
  plan: CatalogPlan,
  isSync: boolean,
  planToken?: string,
): ResolveManifest {
  const nodes: ResolveManifestNode[] = [];
  for (const planNode of plan.toInstall)
    nodes.push(planNodeToManifest(planNode, statusFromDisposition(planNode)));
  for (const planNode of plan.alreadyInstalled) {
    nodes.push(
      planNodeToManifest(
        planNode,
        planNode.disposition === "up-to-date" ? "up-to-date" : "already-installed",
      ),
    );
  }
  for (const conflict of plan.conflicts) nodes.push(conflictToManifest(conflict));

  const rootNode = nodes.find((node) => node.origin === plan.rootOrigin);
  return {
    rootOrigin: plan.rootOrigin,
    rootFqn: rootNode?.fqn ?? "",
    isSync,
    upToDate: plan.upToDate,
    ...(plan.rootAlreadyInstalled ? { rootAlreadyInstalled: true } : {}),
    ...(planToken !== undefined ? { planToken } : {}),
    ...(plan.identityChange !== undefined ? { identityChange: plan.identityChange } : {}),
    orphans: plan.orphans.map((orphan) => ({
      kind: orphan.kind,
      fqn: orphan.fqn,
      origin: orphan.origin,
    })),
    nodes,
  };
}

function statusFromDisposition(planNode: PlanNode): "new" | "will-sync" | "identity-changed" {
  switch (planNode.disposition) {
    case "identity-changed":
      return "identity-changed";
    case "will-sync":
      return "will-sync";
    case "new":
    case "up-to-date":
      return planNode.wasAlreadyInstalled ? "will-sync" : "new";
  }
}

function planNodeToManifest(planNode: PlanNode, status: NodeStatus): ResolveManifestNode {
  const fqn = planNode.fqn;
  if (planNode.kind === "mcp") {
    return {
      kind: "mcp",
      origin: planNode.origin,
      fqn,
      status,
      dependencyOrigins: [],
      specName: fqn,
    };
  }
  const [scope, shortName] = splitFqn(fqn);
  return {
    kind: planNode.kind,
    origin: planNode.origin,
    fqn,
    status,
    dependencyOrigins: [...planNode.dependencyRefs.skills, ...planNode.dependencyRefs.mcps],
    shortName,
    scope,
  };
}

function conflictToManifest(conflict: CatalogConflict): ResolveManifestNode {
  const status =
    conflict.reason.kind === "fetch-failed"
      ? "fetch-failed"
      : conflict.reason.kind === "parse-failed"
        ? "parse-failed"
        : "would-conflict";
  const fqn = conflict.fqn ?? "";
  const error = errorFromConflict(conflict);
  if (conflict.kind === "mcp") {
    return {
      kind: "mcp",
      origin: conflict.origin,
      fqn,
      status,
      dependencyOrigins: [],
      specName: fqn,
      ...(error ? { error } : {}),
    };
  }
  const [scope, shortName] = splitFqn(fqn);
  return {
    kind: conflict.kind,
    origin: conflict.origin,
    fqn,
    status,
    dependencyOrigins: [],
    shortName,
    scope,
    ...(error ? { error } : {}),
  };
}

function splitFqn(fqn: string): [scope: string, shortName: string] {
  const slash = fqn.indexOf("/");
  if (slash < 0) return ["", fqn];
  return [fqn.slice(0, slash), fqn.slice(slash + 1)];
}

function errorFromConflict(
  conflict: CatalogConflict,
): { name: string; message: string } | undefined {
  const reason = conflict.reason;
  if (reason.kind === "origin-conflict") {
    return {
      name: "OriginConflict",
      message: `already installed under origin ${reason.existingOrigin}`,
    };
  }
  const cause = reason.cause;
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  if (typeof cause === "string") return { name: reason.kind, message: cause };
  return { name: reason.kind, message: String(cause) };
}
