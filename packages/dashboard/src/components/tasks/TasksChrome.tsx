import { PlusIcon, RefreshIcon } from "../Icons";

export interface TasksToolbarProps {
  dispatchDisabled: boolean;
  dispatchDisabledTitle: string;
  onDispatch: () => void;
}

/**
 * Page-top action strip for the Tasks view: Dispatch task.
 *
 * The page already auto-polls every `pollIntervalMs` (default 4s) and
 * also refreshes on `visibilitychange`. A
 * manual Refresh button signalled "the page is stale" which is
 * false; Linear / GitHub Actions / Vercel-style live dashboards
 * don't have one either. Dispatch is the only page-top action.
 */
export function TasksToolbar({
  dispatchDisabled,
  dispatchDisabledTitle,
  onDispatch,
}: TasksToolbarProps) {
  return (
    <button
      type="button"
      className="btn btn--primary"
      onClick={onDispatch}
      disabled={dispatchDisabled}
      title={dispatchDisabledTitle}
    >
      <PlusIcon />
      <span>Dispatch task</span>
    </button>
  );
}

export interface TasksEmptyStateProps {
  loading?: boolean;
  title?: string;
  hint?: string;
  /**
   * `"card"` (default) renders the full dashed-border card with icon.
   * `"rail-hint"` renders a calm text-only one-liner (no border, no icon)
   * for the workspace-empty list rail, so it doesn't echo the rich
   * zero-state card carried by the detail pane.
   */
  variant?: "card" | "rail-hint";
}

/**
 * Loading / empty / no-match panel for the task list. `loading=true`
 * renders the spinner variant; otherwise the supplied title + hint
 * are shown.
 */
export function TasksEmptyState({ loading, title, hint, variant = "card" }: TasksEmptyStateProps) {
  if (loading) {
    return (
      <div className="empty">
        <div className="empty__icon spin" aria-hidden="true">
          <RefreshIcon />
        </div>
        <p className="empty__title">Loading tasks…</p>
      </div>
    );
  }
  if (variant === "rail-hint") {
    return (
      <p className="tasks-pane__list-hint" data-testid="tasks-empty-rail-hint">
        {title}
        {hint && ` ${hint}`}
      </p>
    );
  }
  return (
    <div className="empty">
      <div className="empty__icon">📝</div>
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
    </div>
  );
}

/**
 * Calm centered placeholder rendered in the right column when no task
 * is selected (the visible list is empty). Sibling to {@link TasksEmptyState}
 * so the two pieces share styling but live in distinct DOM positions:
 * one inside `.tasks-pane__list`, this one inside `.tasks-pane__detail`.
 */
export function TaskDetailPlaceholder() {
  return (
    <aside className="tasks-pane__detail tasks-pane__detail--empty">
      <div className="empty">
        <div className="empty__icon">📝</div>
        <p className="empty__title">No task selected</p>
        <p className="empty__hint">No tasks match the current filters</p>
      </div>
    </aside>
  );
}

export interface TasksZeroStateProps {
  dispatchDisabled: boolean;
  dispatchDisabledTitle: string;
  onDispatch: () => void;
}

/**
 * Zero-state for a workspace with no tasks at all, rendered inside the
 * right detail pane (sibling to {@link TaskDetailPlaceholder}). The list
 * rail stays mounted alongside it. The Dispatch-task CTA opens the page's
 * own modal in place — no nav.
 */
export function TasksZeroState({
  dispatchDisabled,
  dispatchDisabledTitle,
  onDispatch,
}: TasksZeroStateProps) {
  return (
    <aside className="tasks-pane__detail tasks-pane__detail--empty">
      <div className="empty" data-testid="tasks-empty-zero">
        <div className="empty__icon" aria-hidden="true">
          📝
        </div>
        <p className="empty__title">No tasks yet</p>
        <p className="empty__hint">
          Dispatch a task to run an agent autonomously and read the result here when it finishes.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onDispatch}
          disabled={dispatchDisabled}
          title={dispatchDisabledTitle}
          data-testid="tasks-empty-zero-cta"
        >
          <PlusIcon />
          <span>Dispatch task</span>
        </button>
      </div>
    </aside>
  );
}
