import type { CatalogConflict, CatalogPlan, PlanNode } from "@glyphs-ai/catalog";
import type { ResolveManifest, ResolveManifestNode } from "../../wire/plan-to-manifest.js";

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
