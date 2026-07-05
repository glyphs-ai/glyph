import type { WorkflowDag, WorkflowNode } from "../../api";

/**
 * Project the DAG into a flat, navigation-ordered node list. Includes
 * all nodes that have either a `taskId` (worker/coordinator) or are
 * human-kind (navigable even without a task). Ordering matches the
 * Graph tab's visual top-to-bottom order:
 *
 *   1. phase ASC (earlier phases first)
 *   2. createdAt ASC (within a phase, the node inserted earliest is
 *      walked first — mirrors `groupByPhase` / `buildSlotMap`).
 */
export function orderNodesForNav(dag: WorkflowDag | null): WorkflowNode[] {
  if (dag === null) return [];
  return dag.nodes.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
