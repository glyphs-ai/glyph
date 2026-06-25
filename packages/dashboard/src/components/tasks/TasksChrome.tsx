import { PlusIcon } from "../Icons";

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
