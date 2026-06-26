import type { WorkflowDag, WorkflowHeader } from "../../api";
import type { WorkflowDrillTarget } from "./drill";
import { WorkflowNodeHumanPane } from "./WorkflowNodeHumanPane";
import { WorkflowNodeTaskPane } from "./WorkflowNodeTaskPane";

export interface WorkflowDrillPaneProps {
  /** Active drill discriminant; the caller has already narrowed it non-null. */
  target: NonNullable<WorkflowDrillTarget>;
  workflow: WorkflowHeader;
  dag: WorkflowDag | null;
  effectiveSelectedId: string;
  pollIntervalMs: number;
  onBack: () => void;
  onNavigateNode: (taskId: string) => void;
  onNavigateHumanNode: (nodeId: string) => void;
}

/**
 * Layer A of the Workflows right pane: a thin visual container that
 * switches on the drill discriminant and mounts the matching node
 * pane. The inner pane is keyed on `selectedId:slot` so swapping the
 * drilled node remounts the pane (resetting its per-node fetch / scroll
 * state) instead of reusing the prior node's instance.
 */
export function WorkflowDrillPane({
  target,
  workflow,
  dag,
  effectiveSelectedId,
  pollIntervalMs,
  onBack,
  onNavigateNode,
  onNavigateHumanNode,
}: WorkflowDrillPaneProps) {
  switch (target.kind) {
    case "nodeTask":
      return (
        <WorkflowNodeTaskPane
          key={`${effectiveSelectedId}:${target.nodeTaskId}`}
          workflow={workflow}
          dag={dag}
          nodeTaskId={target.nodeTaskId}
          pollIntervalMs={pollIntervalMs}
          onBack={onBack}
          onNavigate={onNavigateNode}
        />
      );
    case "human":
      return (
        <WorkflowNodeHumanPane
          key={`${effectiveSelectedId}:human:${target.humanNodeId}`}
          workflow={workflow}
          dag={dag}
          nodeId={target.humanNodeId}
          onBack={onBack}
          onNavigate={onNavigateHumanNode}
        />
      );
  }
}
