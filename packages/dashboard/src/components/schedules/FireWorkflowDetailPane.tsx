import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { listScheduledWorkflows, type WorkflowHeaderWire } from "../../api";
import { useWorkflowDetail } from "../../hooks/useWorkflowDetail";
import { WorkflowView } from "../../pages/workflows/WorkflowView";
import { FallbackBackRow, FireNavPill } from "./FireNav";

export interface FireWorkflowDetailPaneProps {
  /** Schedule whose recent-fires list owns the navigation set. */
  scheduleId: string;
  /** Display name for the "← Back to {name}" link in the Mode B nav row. */
  scheduleName: string;
  /** Workflow id requested via `?fireWorkflowId=`. May be stale (aged out of top-10). */
  fireWorkflowId: string;
  /** Called when the user clicks ← Back; parent clears `?fireWorkflowId=`. */
  onBack: () => void;
  /** Called when the user clicks ‹prev / next›; parent atomically sets `?fireWorkflowId=`. */
  onNavigate: (nextWorkflowId: string) => void;
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
  onBack,
  onNavigate,
}: FireWorkflowDetailPaneProps) {
  const [rows, setRows] = useState<WorkflowHeaderWire[] | null>(null);
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
      scheduleName={scheduleName}
      onBack={onBack}
      headerTrailing={pill}
    />
  );
}

interface FireWorkflowViewProps {
  fireWorkflowId: string;
  scheduleName: string;
  onBack: () => void;
  headerTrailing: ReactNode;
}

/**
 * Within a read-only fire snapshot the workflow's DAG nodes are not
 * drill-down targets (the Schedules page has no node-detail URL slot),
 * so node activation is intentionally inert. `WorkflowView` still
 * renders the Graph tab; clicking a node simply does nothing here.
 */
const READONLY_NODE_SELECT = () => {};

/**
 * Inner remount-keyed view that owns the {@link useWorkflowDetail}
 * hook. Renders the shared {@link FallbackBackRow} during the detail
 * fetch's loading / error window (since {@link WorkflowView} requires a
 * non-null workflow), then hands off to `WorkflowView` — which provides
 * its own `.tasks-pane__detail` aside — once the header resolves.
 */
function FireWorkflowView({
  fireWorkflowId,
  scheduleName,
  onBack,
  headerTrailing,
}: FireWorkflowViewProps) {
  const { workflow, dag, error, dagError } = useWorkflowDetail(fireWorkflowId);

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

  return (
    <WorkflowView
      workflow={workflow}
      dag={dag}
      dagError={dagError}
      onSelectNode={READONLY_NODE_SELECT}
      headerTrailing={headerTrailing}
    />
  );
}
