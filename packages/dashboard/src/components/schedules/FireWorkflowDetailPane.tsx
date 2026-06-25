import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listScheduledWorkflows, type WorkflowHeader, type WorkflowNode } from "../../api";
import { useWorkflowDetail } from "../../hooks/useWorkflowDetail";
import { WorkflowNodeHumanPane } from "../../pages/workflows/WorkflowNodeHumanPane";
import { WorkflowNodeTaskPane } from "../../pages/workflows/WorkflowNodeTaskPane";
import { WorkflowView } from "../../pages/workflows/WorkflowView";
import { FallbackBackRow, FireNavPill } from "./FireNav";

export interface FireWorkflowDetailPaneProps {
  /** Schedule whose recent-fires list owns the navigation set. */
  scheduleId: string;
  /** Display name for the "← Back to {name}" link in the Mode B nav row. */
  scheduleName: string;
  /** Workflow id requested via `?fireWorkflowId=`. May be stale (aged out of top-10). */
  fireWorkflowId: string;
  /** Node id requested via `?fireNodeId=`. Null when no node is selected. */
  fireNodeId?: string | null;
  /** Called when the user clicks ← Back; parent clears `?fireWorkflowId=`. */
  onBack: () => void;
  /** Called when the user clicks ‹prev / next›; parent atomically sets `?fireWorkflowId=`. */
  onNavigate: (nextWorkflowId: string) => void;
  /** Called when the user activates a node in the Graph tab. */
  onSelectNode: (nodeId: string) => void;
  /** Called when the user clicks ← Back from the node detail pane. */
  onBackFromNode: () => void;
}

const MAX_ROWS = 10;

/**
 * Schedules-page Mode B (right pane) for a **workflow-kind** schedule —
 * shows the full workflow detail for a single recent fire of the
 * current schedule. The workflow-kind sibling of {@link
 * import("./FireTaskDetailPane").FireTaskDetailPane}: it owns its own
 * {@link listScheduledWorkflows} fetch keyed by `scheduleId` so the
 * prev / next walker steps through the same in-memory list the user
 * clicked from, sharing the {@link FireNavPill} chrome with the task
 * pane.
 *
 * Ownership-gated detail fetch: the inner {@link FireWorkflowView} only
 * mounts once `fireWorkflowId` is confirmed to be in this schedule's
 * recent fires, so a stale URL pointing at an arbitrary workspace
 * workflow can't leak a `getWorkflow` against it. When the fire isn't
 * in the list (e.g. it aged out of the top-{@link MAX_ROWS}) a "Fire
 * not found" notice with a Back button is shown instead.
 *
 * The inner view is keyed on `fireWorkflowId`, so every workflow switch
 * remounts {@link useWorkflowDetail} for a clean React tree (the hook
 * is already race-safe via its monotonic request id — this is
 * defence-in-depth).
 */
export function FireWorkflowDetailPane({
  scheduleId,
  scheduleName,
  fireWorkflowId,
  fireNodeId,
  onBack,
  onNavigate,
  onSelectNode,
  onBackFromNode,
}: FireWorkflowDetailPaneProps) {
  const [rows, setRows] = useState<WorkflowHeader[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    let localCancelled = false;
    setRows(null);
    setError(null);
    listScheduledWorkflows({ scheduleId })
      .then((next) => {
        if (localCancelled || cancelledRef.current) return;
        const sorted = next.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRows(sorted.slice(0, MAX_ROWS));
      })
      .catch((e) => {
        if (localCancelled || cancelledRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      });
    return () => {
      localCancelled = true;
    };
  }, [scheduleId]);

  const confirmedIndex = useMemo(() => {
    if (rows === null) return -1;
    return rows.findIndex((r) => r.id === fireWorkflowId);
  }, [rows, fireWorkflowId]);

  const confirmed = confirmedIndex !== -1;
  // `rows` is sorted newest-first, so `confirmedIndex` is 0-based with
  // 0 = newest. The pill's chevrons follow the visual list direction:
  // `‹` moves to a newer fire (smaller index), `›` to an older one.
  const prevId = confirmed && confirmedIndex > 0 ? (rows?.[confirmedIndex - 1]?.id ?? null) : null;
  const nextId =
    confirmed && confirmedIndex < (rows?.length ?? 0) - 1
      ? (rows?.[confirmedIndex + 1]?.id ?? null)
      : null;

  if (rows === null) {
    return (
      <aside className="tasks-pane__detail">
        <FallbackBackRow scheduleName={scheduleName} onBack={onBack} />
        <p className="muted" style={{ padding: 16 }}>
          Loading…
        </p>
      </aside>
    );
  }

  if (error) {
    return (
      <aside className="tasks-pane__detail">
        <FallbackBackRow scheduleName={scheduleName} onBack={onBack} />
        <div className="alert alert--error" style={{ margin: 16 }}>
          ⚠️ {error}
        </div>
      </aside>
    );
  }

  if (!confirmed) {
    return (
      <aside className="tasks-pane__detail" data-testid="fire-workflow-not-found">
        <FallbackBackRow scheduleName={scheduleName} onBack={onBack} />
        <div className="empty" style={{ padding: 16 }}>
          <p className="empty__title">Fire not found</p>
          <p className="empty__hint">
            This fire is not in this schedule's recent fires (it may have aged out of the top{" "}
            {MAX_ROWS}).
          </p>
        </div>
      </aside>
    );
  }

  const total = rows.length;
  // Position counter uses the user's mental model: row 1 is the newest
  // fire. `confirmedIndex` is 0-based with 0 = newest, so display index + 1.
  const position = confirmedIndex + 1;

  const pill = (
    <FireNavPill
      scheduleName={scheduleName}
      position={position}
      total={total}
      onBack={onBack}
      onPrev={prevId ? () => onNavigate(prevId) : null}
      onNext={nextId ? () => onNavigate(nextId) : null}
    />
  );

  return (
    <FireWorkflowView
      key={fireWorkflowId}
      fireWorkflowId={fireWorkflowId}
      fireNodeId={fireNodeId ?? null}
      scheduleName={scheduleName}
      onBack={onBack}
      onSelectNode={onSelectNode}
      onBackFromNode={onBackFromNode}
      headerTrailing={pill}
    />
  );
}

interface FireWorkflowViewProps {
  fireWorkflowId: string;
  fireNodeId: string | null;
  scheduleName: string;
  onBack: () => void;
  onSelectNode: (nodeId: string) => void;
  onBackFromNode: () => void;
  headerTrailing: ReactNode;
}

/**
 * Inner remount-keyed view that owns the {@link useWorkflowDetail}
 * hook. When `fireNodeId` is set, renders the node-detail pane instead
 * of the workflow tabs. Otherwise renders `WorkflowView` with a live
 * `onSelectNode` handler so the Graph tab's nodes are clickable.
 */
function FireWorkflowView({
  fireWorkflowId,
  fireNodeId,
  scheduleName,
  onBack,
  onSelectNode,
  onBackFromNode,
  headerTrailing,
}: FireWorkflowViewProps) {
  const { workflow, dag, error, dagError } = useWorkflowDetail(fireWorkflowId);

  const handleSelectNode = useCallback(
    (node: WorkflowNode) => {
      if (node.spec.kind === "human") {
        onSelectNode(node.id);
      } else {
        if (node.taskId === undefined) return;
        onSelectNode(node.id);
      }
    },
    [onSelectNode],
  );

  // Derive the node-level selection for the Graph tab highlight.
  const selectedNodeId = fireNodeId;

  if (workflow === null) {
    return (
      <aside className="tasks-pane__detail">
        <FallbackBackRow scheduleName={scheduleName} onBack={onBack} />
        {error !== null ? (
          <div className="alert alert--error" style={{ margin: 16 }}>
            ⚠️ {error}
          </div>
        ) : (
          <p className="muted" style={{ padding: 16 }}>
            Loading…
          </p>
        )}
      </aside>
    );
  }

  // When a node is selected, render the appropriate node-detail pane.
  if (fireNodeId !== null && dag !== null) {
    const node = dag.nodes.find((n) => n.id === fireNodeId);
    if (node !== undefined) {
      if (node.spec.kind === "human") {
        return (
          <WorkflowNodeHumanPane
            key={`${fireWorkflowId}:human:${fireNodeId}`}
            workflow={workflow}
            dag={dag}
            nodeId={fireNodeId}
            onBack={onBackFromNode}
            onNavigate={onSelectNode}
          />
        );
      }
      if (node.taskId !== undefined) {
        return (
          <WorkflowNodeTaskPane
            key={`${fireWorkflowId}:${fireNodeId}`}
            workflow={workflow}
            dag={dag}
            nodeTaskId={node.taskId}
            pollIntervalMs={4000}
            onBack={onBackFromNode}
            onNavigate={(nextTaskId: string) => {
              // Find the node with this taskId and navigate to its node id.
              const target = dag.nodes.find((n) => n.taskId === nextTaskId);
              if (target) onSelectNode(target.id);
            }}
          />
        );
      }
    }
  }

  return (
    <WorkflowView
      workflow={workflow}
      dag={dag}
      dagError={dagError}
      selectedNodeId={selectedNodeId}
      onSelectNode={handleSelectNode}
      headerTrailing={headerTrailing}
    />
  );
}
