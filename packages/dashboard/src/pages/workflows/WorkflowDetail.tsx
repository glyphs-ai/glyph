import type { WorkflowDag, WorkflowHeader, WorkflowNode } from "../../api";
import { WorkflowView } from "./WorkflowView";

export interface WorkflowDetailProps {
  workflow: WorkflowHeader;
  dag: WorkflowDag | null;
  dagError: string | null;
  /** When non-null the parent has highlighted a node (Mode B in scope). */
  selectedNodeId?: string | null;
  /** Fired from the Graph tab when the user activates a node chip. */
  onSelectNode: (node: WorkflowNode) => void;
}

/**
 * Right-pane workflow detail. Now a one-line forwarder to
 * {@link WorkflowView}: the tab host owns all rendering, this file
 * exists only to keep the existing import path stable for callers
 * outside the page (e.g. snapshot tests, storybook).
 *
 * Cancel action lives on the per-row `` menu; this pane no longer
 * carries a `cancelBusy` / `onCancel` prop.
 */
export function WorkflowDetail(props: WorkflowDetailProps) {
  return <WorkflowView {...props} />;
}
