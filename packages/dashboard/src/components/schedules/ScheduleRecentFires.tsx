import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  listScheduledTasks,
  listScheduledWorkflows,
  type TaskRecord,
  type WorkflowHeader,
} from "../../api";
import { useClickOutside } from "../../hooks/useClickOutside";
import { copyToClipboard } from "../../utils/clipboard";
import { formatAbsolute, formatClockTime, formatDuration, formatRelative } from "../../utils/time";
import { MoreHorizontalIcon } from "../Icons";
import { StatusBadge } from "../tasks/StatusBadge";
import { STATUS_TONE } from "../tasks/shared";
import { WorkflowStatusBadge } from "../workflows/WorkflowStatusBadge";

export interface ScheduleRecentFiresProps {
  scheduleId: string;
  kind: string;
  currentWorkspaceId: string;
  refreshToken: number;
  onSelectFire?: (fireId: string) => void;
  onCancelTaskFire?: (taskId: string) => Promise<void> | void;
  onCancelWorkflowFire?: (workflow: WorkflowHeader) => Promise<void> | void;
  /**
   * Reports the resolved fire count up to the parent so the detail tab
   * can render a `Recent fires (N)` badge. `null` means "not resolved
   * yet" (initial load) so the badge can omit the count rather than
   * flash a misleading `(0)` while the fetch is in flight.
   */
  onCountChange?: (count: number | null) => void;
}

const MAX_ROWS = 10;

type CloseReason = "escape" | "menuitem" | "outside";

export function ScheduleRecentFires(props: ScheduleRecentFiresProps) {
  return (
    <section className="schedule-detail__recent" aria-label="Recent fires">
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
  onCancelTaskFire,
  onCountChange,
}: ScheduleRecentFiresProps) {
  const [rows, setRows] = useState<TaskRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCountChange?.(rows === null ? null : rows.length);
  }, [rows, onCountChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally part of the re-fetch trigger set
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
  if (rows === null) return <MutedLoading />;
  if (rows.length === 0) return <MutedEmpty />;
  return (
    <ul className="task-list" style={{ borderTop: "1px solid var(--color-border)" }}>
      {rows.map((task) => (
        <TaskFireRow
          key={task.id}
          task={task}
          currentWorkspaceId={currentWorkspaceId}
          onSelectFire={onSelectFire}
          onCancelTaskFire={onCancelTaskFire}
        />
      ))}
    </ul>
  );
}

function WorkflowFiresBody({
  scheduleId,
  currentWorkspaceId,
  refreshToken,
  onSelectFire,
  onCancelWorkflowFire,
  onCountChange,
}: ScheduleRecentFiresProps) {
  const [rows, setRows] = useState<WorkflowHeader[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCountChange?.(rows === null ? null : rows.length);
  }, [rows, onCountChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally part of the re-fetch trigger set
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
  if (rows === null) return <MutedLoading />;
  if (rows.length === 0) return <MutedEmpty />;
  return (
    <ul className="task-list" style={{ borderTop: "1px solid var(--color-border)" }}>
      {rows.map((workflow) => (
        <WorkflowFireRow
          key={workflow.id}
          workflow={workflow}
          currentWorkspaceId={currentWorkspaceId}
          onSelectFire={onSelectFire}
          onCancelWorkflowFire={onCancelWorkflowFire}
        />
      ))}
    </ul>
  );
}

function MutedLoading() {
  return (
    <p className="muted" style={{ fontSize: 12 }}>
      Loading…
    </p>
  );
}

function MutedEmpty() {
  return (
    <p className="muted" style={{ fontSize: 12 }}>
      This schedule hasn't fired yet.
    </p>
  );
}

interface TaskFireRowProps {
  task: TaskRecord;
  currentWorkspaceId: string;
  onSelectFire?: (taskId: string) => void;
  onCancelTaskFire?: (taskId: string) => Promise<void> | void;
}

function TaskFireRow({
  task,
  currentWorkspaceId,
  onSelectFire,
  onCancelTaskFire,
}: TaskFireRowProps) {
  const durationLabel = formatDuration(task.startedAt, task.endedAt ?? null);
  const content = (
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

  return (
    <li className="task-list__item">
      {onSelectFire ? (
        <button
          type="button"
          className="task-list__item-select task-list__item--row"
          onClick={() => onSelectFire(task.id)}
          data-testid={`schedule-fire-row-${task.id}`}
          title="Open this fire's task detail"
          aria-label={`Open fire task ${task.id}`}
        >
          {content}
        </button>
      ) : (
        <Link
          to={`/workspaces/${encodeURIComponent(currentWorkspaceId)}/runtime/tasks?taskId=${encodeURIComponent(
            task.id,
          )}`}
          className="task-list__item-select task-list__item--row"
          data-testid={`schedule-fire-row-${task.id}`}
          aria-label={`Open fire task ${task.id} in Tasks page`}
        >
          {content}
        </Link>
      )}
      <FireRowMenu
        fireId={task.id}
        fireLabel={`task ${task.id}`}
        onOpen={onSelectFire ? () => onSelectFire(task.id) : undefined}
        onCancel={
          onCancelTaskFire !== undefined ? async () => onCancelTaskFire(task.id) : undefined
        }
        cancelDisabled={isTerminalStatus(task.status)}
        cancelLabel={isTerminalStatus(task.status) ? "Cancel — already terminal" : "Cancel"}
      />
    </li>
  );
}

interface WorkflowFireRowProps {
  workflow: WorkflowHeader;
  currentWorkspaceId: string;
  onSelectFire?: (workflowId: string) => void;
  onCancelWorkflowFire?: (workflow: WorkflowHeader) => Promise<void> | void;
}

function WorkflowFireRow({
  workflow,
  currentWorkspaceId,
  onSelectFire,
  onCancelWorkflowFire,
}: WorkflowFireRowProps) {
  const durationLabel =
    workflow.startedAt !== undefined
      ? formatDuration(workflow.startedAt, workflow.endedAt ?? null)
      : "—";
  const content = (
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

  return (
    <li className="task-list__item">
      {onSelectFire ? (
        <button
          type="button"
          className="task-list__item-select task-list__item--row"
          onClick={() => onSelectFire(workflow.id)}
          data-testid={`schedule-fire-row-${workflow.id}`}
          title="Open this fire's workflow detail"
          aria-label={`Open fire workflow ${workflow.id}`}
        >
          {content}
        </button>
      ) : (
        <Link
          to={`/workspaces/${encodeURIComponent(
            currentWorkspaceId,
          )}/runtime/workflows?workflowId=${encodeURIComponent(workflow.id)}`}
          className="task-list__item-select task-list__item--row"
          data-testid={`schedule-fire-row-${workflow.id}`}
          aria-label={`Open fire workflow ${workflow.id} in Workflows page`}
        >
          {content}
        </Link>
      )}
      <FireRowMenu
        fireId={workflow.id}
        fireLabel={`workflow ${workflow.id}`}
        onOpen={onSelectFire ? () => onSelectFire(workflow.id) : undefined}
        onCancel={
          onCancelWorkflowFire !== undefined
            ? async () => onCancelWorkflowFire(workflow)
            : undefined
        }
        cancelDisabled={isTerminalStatus(workflow.status)}
        cancelLabel={isTerminalStatus(workflow.status) ? "Cancel — already terminal" : "Cancel"}
      />
    </li>
  );
}

interface FireRowMenuProps {
  fireId: string;
  fireLabel: string;
  onOpen?: () => void;
  onCancel?: () => Promise<void>;
  cancelDisabled: boolean;
  cancelLabel: string;
}

function FireRowMenu({
  fireId,
  fireLabel,
  onOpen,
  onCancel,
  cancelDisabled,
  cancelLabel,
}: FireRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const [maxHeightPx, setMaxHeightPx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const refs = useMemo(() => [triggerRef, panelRef], []);

  const closeMenu = useCallback((reason: CloseReason) => {
    setOpen(false);
    if (reason === "escape" || reason === "menuitem") {
      triggerRef.current?.focus();
      return;
    }
    setTimeout(() => {
      if (document.activeElement === document.body) {
        triggerRef.current?.focus();
      }
    }, 0);
  }, []);

  useClickOutside(refs, () => closeMenu("outside"), open);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const MARGIN = 8;
    const findScrollContainer = (el: HTMLElement | null): HTMLElement | null => {
      let node: HTMLElement | null = el?.parentElement ?? null;
      while (node && node !== document.body) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
        node = node.parentElement;
      }
      return null;
    };

    const container = findScrollContainer(trigger);
    let cachedPanelHeight: number | null = null;

    const measure = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const containerRect = container?.getBoundingClientRect();
      const viewportTop = containerRect?.top ?? 0;
      const nextRowTrigger =
        trigger
          .closest("li")
          ?.nextElementSibling?.querySelector<HTMLElement>(".task-list__item-menu-trigger") ?? null;
      const containerBottom = containerRect?.bottom ?? window.innerHeight;
      const viewportBottom = nextRowTrigger
        ? Math.min(containerBottom, nextRowTrigger.getBoundingClientRect().top)
        : containerBottom;

      if (cachedPanelHeight == null) {
        const prevMaxHeight = panel.style.maxHeight;
        panel.style.maxHeight = "";
        cachedPanelHeight = panel.getBoundingClientRect().height;
        panel.style.maxHeight = prevMaxHeight;
      }

      const panelHeight = cachedPanelHeight;
      const spaceBelow = viewportBottom - triggerRect.bottom;
      const spaceAbove = triggerRect.top - viewportTop;

      if (spaceBelow >= panelHeight + MARGIN) {
        setPlacement("below");
        setMaxHeightPx(null);
      } else if (spaceAbove >= panelHeight + MARGIN) {
        setPlacement("above");
        setMaxHeightPx(null);
      } else if (spaceAbove > spaceBelow) {
        setPlacement("above");
        setMaxHeightPx(Math.max(0, spaceAbove - MARGIN));
      } else {
        setPlacement("below");
        setMaxHeightPx(Math.max(0, spaceBelow - MARGIN));
      }
    };

    measure();

    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    const scrollTarget: EventTarget = container ?? window;
    scrollTarget.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scrollTarget.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu("escape");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    e.preventDefault();
    const arr = Array.from(items);
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? arr.indexOf(active as HTMLButtonElement) : -1;
    const next =
      e.key === "ArrowDown"
        ? arr[(idx + 1 + arr.length) % arr.length]
        : arr[(idx - 1 + arr.length) % arr.length];
    next?.focus();
  };

  const handleCopyId = async () => {
    await copyToClipboard(fireId);
    closeMenu("menuitem");
  };

  const handleCancel = async () => {
    if (busy || cancelDisabled || onCancel === undefined) return;
    closeMenu("menuitem");
    setBusy(true);
    try {
      await onCancel();
    } catch {
      // Parent surfaces the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-list__item-menu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--icon task-list__item-menu-trigger"
        aria-label={`Actions for ${fireLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        data-testid={`schedule-fire-row-menu-trigger-${fireId}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontalIcon />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className={`task-list__item-menu-panel task-list__item-menu-panel--${placement}`}
          role="menu"
          data-testid={`schedule-fire-row-menu-${fireId}`}
          style={
            maxHeightPx != null
              ? ({ "--menu-max-height": `${maxHeightPx}px` } as React.CSSProperties)
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handlePanelKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            className="task-list__item-menu-option"
            disabled={onOpen === undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (onOpen === undefined) return;
              closeMenu("menuitem");
              onOpen();
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="task-list__item-menu-option"
            onClick={(e) => {
              e.stopPropagation();
              void handleCopyId();
            }}
          >
            Copy ID
          </button>
          <hr
            style={{
              height: 1,
              background: "var(--color-border)",
              margin: "4px 0",
              border: "none",
            }}
          />
          <button
            type="button"
            role="menuitem"
            className="task-list__item-menu-option task-list__item-menu-option--danger"
            disabled={busy || cancelDisabled || onCancel === undefined}
            onClick={(e) => {
              e.stopPropagation();
              void handleCancel();
            }}
          >
            {busy ? "Cancelling…" : cancelLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function isTerminalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
