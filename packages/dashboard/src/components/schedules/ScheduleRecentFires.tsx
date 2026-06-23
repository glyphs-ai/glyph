import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listScheduledTasks,
  listScheduledWorkflows,
  type TaskRecord,
  type WorkflowHeaderWire,
} from "../../api";
import { formatAbsolute, formatClockTime, formatDuration, formatRelative } from "../../utils/time";
import { StatusBadge } from "../tasks/StatusBadge";
import { STATUS_TONE } from "../tasks/shared";
import { WorkflowStatusBadge } from "../workflows/WorkflowStatusBadge";

export interface ScheduleRecentFiresProps {
  /** Schedule id used to scope the `?scheduleId=` query. */
  scheduleId: string;
  /**
   * Target kind of the selected schedule. Drives which fire history
   * the panel fetches: `"task"` reads `listScheduledTasks`, `"workflow"`
   * reads `listScheduledWorkflows`. Any other kind renders a stub —
   * forward-compatible with substrate kinds the dashboard can't yet
   * project.
   */
  kind: string;
  /** UUID of the workspace currently in scope — used to build deep-link URLs. */
  currentWorkspaceId: string;
  /**
   * Bumps each time the parent wants to force a refresh (e.g. after
   * the user clicked "Run now" and a new running fire was created on
   * the server side). Polling on top would be overkill for v1 — the
   * page already auto-refreshes on tab visibility.
   */
  refreshToken: number;
  /**
   * Callback fired when the user clicks a recent-fire row. The parent
   * page swaps the detail-pane into Mode B (the fire's detail) by
   * writing `?fireTaskId=<id>` (task kind) or `?fireWorkflowId=<id>`
   * (workflow kind) to the URL atomically with `?scheduleId=`. Falls
   * back to a deep-link to the Tasks / Workflows page when not provided
   * (early-mount or out-of-tree consumers).
   */
  onSelectFire?: (fireId: string) => void;
}

const MAX_ROWS = 10;

/**
 * "Recent fires" panel rendered inside the schedule detail panel.
 * Lists the latest 10 schedule-launched runs scoped to the current
 * schedule id; clicking a row swaps the right-pane into Mode B (the
 * fire's full detail) by calling `onSelectFire` — no navigation, the
 * schedule list stays visible. When `onSelectFire` isn't wired the row
 * falls back to a deep-link into the Tasks / Workflows page.
 *
 * The fire history is kind-discriminated: task-kind schedules surface
 * their `TaskRecord` fires; workflow-kind schedules surface their
 * `WorkflowHeaderWire` fires. The two bodies own their own fetch +
 * render so each stays correctly typed (no union narrowing at the row
 * boundary).
 */
export function ScheduleRecentFires(props: ScheduleRecentFiresProps) {
  return (
    <section className="schedule-detail__recent" aria-label="Recent fires">
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px 0" }}>Recent fires</h3>
      {props.kind === "workflow" ? (
        <WorkflowFiresBody {...props} />
      ) : props.kind === "task" ? (
        <TaskFiresBody {...props} />
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          This schedule kind has no fire history view yet.
        </p>
      )}
    </section>
  );
}

function TaskFiresBody({
  scheduleId,
  currentWorkspaceId,
  refreshToken,
  onSelectFire,
}: ScheduleRecentFiresProps) {
  const [rows, setRows] = useState<TaskRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally part of the re-fetch trigger set; parent bumps it after a run-now to surface the synthetic task row
  useEffect(() => {
    let cancelled = false;
    setError(null);
    listScheduledTasks({ scheduleId })
      .then((next) => {
        if (cancelled) return;
        next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRows(next.slice(0, MAX_ROWS));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scheduleId, refreshToken]);

  if (error) return <div className="alert alert--error">⚠️ {error}</div>;
  if (rows === null)
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        Loading…
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        This schedule hasn't fired yet.
      </p>
    );
  return (
    <ul className="task-list" style={{ borderTop: "1px solid var(--color-border)" }}>
      {rows.map((t) => (
        <li key={t.id}>
          <ScheduleFireRow
            task={t}
            currentWorkspaceId={currentWorkspaceId}
            onSelectFire={onSelectFire}
          />
        </li>
      ))}
    </ul>
  );
}

function WorkflowFiresBody({
  scheduleId,
  currentWorkspaceId,
  refreshToken,
  onSelectFire,
}: ScheduleRecentFiresProps) {
  const [rows, setRows] = useState<WorkflowHeaderWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally part of the re-fetch trigger set; parent bumps it after a run-now to surface the synthetic workflow row
  useEffect(() => {
    let cancelled = false;
    setError(null);
    listScheduledWorkflows({ scheduleId })
      .then((next) => {
        if (cancelled) return;
        const sorted = next.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRows(sorted.slice(0, MAX_ROWS));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scheduleId, refreshToken]);

  if (error) return <div className="alert alert--error">⚠️ {error}</div>;
  if (rows === null)
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        Loading…
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="muted" style={{ fontSize: 12 }}>
        This schedule hasn't fired yet.
      </p>
    );
  return (
    <ul className="task-list" style={{ borderTop: "1px solid var(--color-border)" }}>
      {rows.map((w) => (
        <li key={w.id}>
          <ScheduleWorkflowFireRow
            workflow={w}
            currentWorkspaceId={currentWorkspaceId}
            onSelectFire={onSelectFire}
          />
        </li>
      ))}
    </ul>
  );
}

interface ScheduleFireRowProps {
  task: TaskRecord;
  currentWorkspaceId: string;
  onSelectFire?: (taskId: string) => void;
}

/**
 * Single recent-fire row. When `onSelectFire` is set the row is a
 * real `<button>` so keyboard and click semantics come for free; when
 * it isn't (early-mount or out-of-tree consumers) the row falls back
 * to a `<Link>` to the Tasks page so deep-linking still works.
 *
 * Layout is the **dense single-row** variant of `.task-list__item`:
 * a CSS-Grid row with columns `[status badge] [wall-clock] [duration]
 * [task id]`. The brief / agent / runtime aren't surfaced because
 * they are constant across every row of a single schedule's fires
 * (this list is already scoped to one schedule) — surfacing them
 * would only burn vertical space. Duration is computed from
 * `startedAt` → `endedAt`; for status='running' the missing endedAt
 * is filled with `Date.now()` by `formatDuration`, yielding a static
 * "elapsed so far" reading (refreshes whenever the row re-renders;
 * intentionally not live-ticking).
 */
function ScheduleFireRow({ task, currentWorkspaceId, onSelectFire }: ScheduleFireRowProps) {
  const durationLabel = formatDuration(task.startedAt, task.endedAt ?? null);
  const meta = (
    <>
      <StatusBadge
        status={task.status}
        tone={STATUS_TONE[task.status]}
        pulse={task.status === "running"}
      />
      <span
        className="task-list__row-clock"
        title={`${formatAbsolute(task.createdAt)} · ${formatRelative(task.createdAt)}`}
      >
        {formatClockTime(task.createdAt)}
      </span>
      <span className="task-list__row-duration" title="Run duration">
        {durationLabel}
      </span>
      <code className="task-list__row-id" title={task.id}>
        {task.id}
      </code>
    </>
  );

  if (onSelectFire) {
    return (
      <button
        type="button"
        className="task-list__item task-list__item--button task-list__item--row"
        onClick={() => onSelectFire(task.id)}
        data-testid={`schedule-fire-row-${task.id}`}
        title="Open this fire's task detail"
        aria-label={`Open fire task ${task.id}`}
      >
        {meta}
      </button>
    );
  }
  return (
    <Link
      to={`/workspaces/${encodeURIComponent(currentWorkspaceId)}/runtime/tasks?taskId=${encodeURIComponent(
        task.id,
      )}`}
      className="task-list__item task-list__item--button task-list__item--row"
      data-testid={`schedule-fire-row-${task.id}`}
      aria-label={`Open fire task ${task.id} in Tasks page`}
    >
      {meta}
    </Link>
  );
}

interface ScheduleWorkflowFireRowProps {
  workflow: WorkflowHeaderWire;
  currentWorkspaceId: string;
  onSelectFire?: (workflowId: string) => void;
}

/**
 * Workflow-kind recent-fire row. Mirrors {@link ScheduleFireRow}'s
 * dense single-row layout (`[status badge] [wall-clock] [duration]
 * [workflow id]`) but reads workflow facts: the {@link WorkflowStatusBadge}
 * for the workflow's lifecycle status and the workflow id as the row
 * code. Duration is only computed once the workflow has a `startedAt`
 * (a queued-but-not-started workflow has none, so it shows an em dash).
 */
function ScheduleWorkflowFireRow({
  workflow,
  currentWorkspaceId,
  onSelectFire,
}: ScheduleWorkflowFireRowProps) {
  const durationLabel =
    workflow.startedAt !== undefined
      ? formatDuration(workflow.startedAt, workflow.endedAt ?? null)
      : "—";
  const meta = (
    <>
      <WorkflowStatusBadge status={workflow.status} />
      <span
        className="task-list__row-clock"
        title={`${formatAbsolute(workflow.createdAt)} · ${formatRelative(workflow.createdAt)}`}
      >
        {formatClockTime(workflow.createdAt)}
      </span>
      <span className="task-list__row-duration" title="Run duration">
        {durationLabel}
      </span>
      <code className="task-list__row-id" title={workflow.id}>
        {workflow.id}
      </code>
    </>
  );

  if (onSelectFire) {
    return (
      <button
        type="button"
        className="task-list__item task-list__item--button task-list__item--row"
        onClick={() => onSelectFire(workflow.id)}
        data-testid={`schedule-fire-row-${workflow.id}`}
        title="Open this fire's workflow detail"
        aria-label={`Open fire workflow ${workflow.id}`}
      >
        {meta}
      </button>
    );
  }
  return (
    <Link
      to={`/workspaces/${encodeURIComponent(currentWorkspaceId)}/runtime/workflows?workflowId=${encodeURIComponent(
        workflow.id,
      )}`}
      className="task-list__item task-list__item--button task-list__item--row"
      data-testid={`schedule-fire-row-${workflow.id}`}
      aria-label={`Open fire workflow ${workflow.id} in Workflows page`}
    >
      {meta}
    </Link>
  );
}
