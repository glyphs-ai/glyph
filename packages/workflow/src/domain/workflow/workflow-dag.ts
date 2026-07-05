import type { WorkflowNodeEntity } from "../node/workflow-node-entity.js";

export function computePhaseFromParents(parents: readonly WorkflowNodeEntity[]): number {
  if (parents.length === 0) return 0;
  let maxPhase = -1;
  for (const parent of parents) if (parent.phase > maxPhase) maxPhase = parent.phase;
  return maxPhase + 1;
}

export function wouldCreateCycle(
  edges: readonly { readonly from: string; readonly to: string }[],
  newEdge: { readonly from: string; readonly to: string },
): boolean {
  if (newEdge.from === newEdge.to) return true;
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)?.push(edge.to);
  }
  const visited = new Set<string>();
  const stack: string[] = [newEdge.to];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === newEdge.from) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export function structuralLeaves(
  nodes: readonly WorkflowNodeEntity[],
  edges: readonly { readonly from: string; readonly to: string }[],
): WorkflowNodeEntity[] {
  const hasChild = new Set<string>();
  for (const edge of edges) hasChild.add(edge.from);
  return nodes.filter((node) => !hasChild.has(node.id));
}
