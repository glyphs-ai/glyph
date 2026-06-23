import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listScheduledTasks, type TaskRecord } from "../../api";
import { useTaskDetail } from "../../hooks/useTaskDetail";
import { TaskView } from "../task-view";
import { FallbackBackRow, FireNavPill } from "./FireNav";

export interface FireTaskDetailPaneProps {
  /** Schedule whose recent-fires list owns the navigation set. */
  scheduleId: string;
  /** Display name for the "← Back to {name}" link in the Mode B nav row. */
  scheduleName: string;
  /** Task id requested via `?fireTaskId=`. May be stale (aged out of top-10). */
  fireTaskId: string;
  /** Per-task auto-poll interval (passed through to {@link useTaskDetail}). */
  pollIntervalMs: number;
  /** Called when the user clicks ← Back; parent clears `?fireTaskId=`. */
  onBack: () => void;
  /** Called when the user clicks ‹prev / next›; parent atomically sets `?fireTaskId=`. */
  onNavigate: (nextTaskId: string) => void;
}

const MAX_ROWS = 10;

/**
 * Schedules-page Mode B (right pane) — shows the full task detail for a
 * single recent fire of the current schedule. Owns its own
 * {@link listScheduledTasks} fetch keyed by `scheduleId` so the prev /
 * next navigation can walk the same in-memory list the user just clicked
 * from, with no coupling to the Tasks page smart layer.
 *
 * Ownership-gated `useTaskDetail`: the inner {@link FireTaskView} only
 * mounts once `fireTaskId` is confirmed to be in this schedule's recent
 * fires. A stale URL pointing at an arbitrary workspace task therefore
 * cannot leak a `getTask` against it. When the fire isn't in the list
 * (e.g. it aged out of the top-10) a "Fire not found" notice with a
 * Back button is shown instead.
 *
 * The inner view is keyed on `fireTaskId` — every task switch remounts
 * the {@link useTaskDetail} hook. This is now defence-in-depth (the
 * hook is race-safe via its monotonic request id), but cheap and
 * worth keeping to guarantee a clean React tree on every fire swap.
 *
 * Layout contract: returns a single `.tasks-pane__detail` aside (mirrors
 * the standalone `TaskDetail` smart container) so the Schedules-page
 * 2-column grid keeps its existing scroll / flex semantics.
 *
 * Navigation chrome: success-path navigation (← Back · ‹ N/M ›) lives
 * inside the `TaskView` title row via the `headerTrailing` slot, costing
 * zero extra vertical space. Loading / error / not-found states fall back
 * to a small back-only row above the body, since prev/next have no
 * meaning without a selected task.
 */
export function FireTaskDetailPane({
  scheduleId,
  scheduleName,
  fireTaskId,
  pollIntervalMs,
  onBack,
  onNavigate,
}: FireTaskDetailPaneProps) {
  const [rows, setRows] = useState<TaskRecord[] | null>(null);
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
    listScheduledTasks({ scheduleId })
      .then((next) => {
        if (localCancelled || cancelledRef.current) return;
        next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRows(next.slice(0, MAX_ROWS));
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
    return rows.findIndex((r) => r.id === fireTaskId);
  }, [rows, fireTaskId]);

  const confirmed = confirmedIndex !== -1;
  // `rows` is sorted newest-first, so `confirmedIndex` is 0-based with
  // 0 = newest and `length - 1` = oldest. The pill's chevrons follow the
  // visual list direction (and the position counter `N / total`):
  //   `‹` decreases the displayed position -> moves to a newer fire
  //        (index - 1, smaller index in the newest-first array)
  //   `›` increases the displayed position -> moves to an older fire
  //        (index + 1, larger index)
  // This matches how users scroll through email / commit / chat lists.
  const prevId = confirmed && confirmedIndex > 0 ? (rows![confirmedIndex - 1]?.id ?? null) : null;
  const nextId =
    confirmed && confirmedIndex < (rows?.length ?? 0) - 1
      ? (rows![confirmedIndex + 1]?.id ?? null)
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
      <aside className="tasks-pane__detail" data-testid="fire-task-not-found">
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
  // fire. `confirmedIndex` is 0-based with 0 = newest, so the displayed
  // position is `index + 1`.
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
    <aside className="tasks-pane__detail">
      <FireTaskView
        key={fireTaskId}
        fireTaskId={fireTaskId}
        pollIntervalMs={pollIntervalMs}
        headerTrailing={pill}
      />
    </aside>
  );
}

interface FireTaskViewProps {
  fireTaskId: string;
  pollIntervalMs: number;
  headerTrailing?: ReactNode;
}

/**
 * Inner remount-keyed view that owns the `useTaskDetail` hook. The
 * hook is race-safe on its own (monotonic `requestSeqRef` drops stale
 * responses), so the `key={fireTaskId}` remount from the parent is
 * defence-in-depth: it guarantees a clean React tree on every task
 * switch.
 */
function FireTaskView({ fireTaskId, pollIntervalMs, headerTrailing }: FireTaskViewProps) {
  const { task, activity, activityError, loadOlder } = useTaskDetail(fireTaskId, pollIntervalMs);
  const handleLoadOlder = useCallback(() => loadOlder(), [loadOlder]);
  return (
    <TaskView
      task={task}
      requestedTaskId={fireTaskId}
      activity={activity}
      activityError={activityError}
      onLoadOlder={handleLoadOlder}
      headerTrailing={headerTrailing}
    />
  );
}
