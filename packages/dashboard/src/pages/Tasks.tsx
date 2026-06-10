import type { AgentEntry } from "@glyphs-ai/contracts";
import { useCallback, useMemo, useState } from "react";
import {
  cancelTask,
  type DispatchTaskOpts,
  deleteTask,
  dispatchTask,
  type ServerConfig,
  type TaskRecord,
} from "../api";
import { HeaderActions } from "../components/HeaderActions";
import { DispatchModal } from "../components/tasks/DispatchModal";
import {
  ALL_AGENTS,
  ALL_RUNTIMES,
  coerceTimePreset,
  DEFAULT_TIME_PRESET,
  type TimePreset,
} from "../components/tasks/shared";
import { TaskConfirmModalsHost } from "../components/tasks/TaskConfirmModals";
import { TaskDetail } from "../components/tasks/TaskDetail";
import { TaskFilters } from "../components/tasks/TaskFilters";
import { TaskList } from "../components/tasks/TaskList";
import {
  TaskDetailPlaceholder,
  TasksEmptyState,
  TasksToolbar,
  TasksZeroState,
} from "../components/tasks/TasksChrome";
import { useMounted } from "../hooks/useMounted";
import { useSelectedTask } from "../hooks/useSelectedTask";
import { useTasks } from "../hooks/useTasks";
import { useUrlSearchValue } from "../hooks/useUrlState";

interface TasksProps {
  agents: AgentEntry[];
  /** UUID of the workspace currently in scope (from the URL); null = no workspace. */
  currentWorkspaceId: string | null;
  /** Server-supplied config; null while still being fetched. */
  config: ServerConfig | null;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;

/**
 * Tasks page — fire-and-forget agent dispatch, autonomous run,
 * polling detail view. Master-detail layout: a filtered + grouped
 * task list on the left, a tabbed detail panel on the right.
 *
 * Every filter (`?agent`, `?runtime`, `?range`, `?q`) plus the
 * master-detail selection (`?taskId`) is URL-driven via
 * {@link useUrlSearchValue}, so refresh / back-button / shared link all
 * reproduce the same view.
 */
export function TasksPage({ agents, currentWorkspaceId, config }: TasksProps) {
  const pollIntervalMs = config?.tasks?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  // URL-driven filter state.
  const [idQuery, setIdQuery] = useUrlSearchValue("q", "");
  const [agentFilterUrl, setAgentFilterUrl] = useUrlSearchValue("agent", ALL_AGENTS);
  const [runtimeFilter, setRuntimeFilter] = useUrlSearchValue("runtime", ALL_RUNTIMES);
  const [rangeUrl, setRangeUrl] = useUrlSearchValue("range", DEFAULT_TIME_PRESET);

  const agentFilter = agentFilterUrl;
  const setAgentFilter = setAgentFilterUrl;
  const timeFilter = coerceTimePreset(rangeUrl);
  const setTimeFilter = (v: TimePreset) => setRangeUrl(v);

  const { selectedId, setSelectedId } = useSelectedTask();
  const data = useTasks({
    currentWorkspaceId,
    pollIntervalMs,
    agentFilter,
    runtimeFilter,
    timeFilter,
  });
  const { tasks, runtimes, loaded, error, setError, refresh } = data;

  const [dispatchOpen, setDispatchOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskRecord | null>(null);
  const [deletePurge, setDeletePurge] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<TaskRecord | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [rerunFrom, setRerunFrom] = useState<TaskRecord | null>(null);

  const mounted = useMounted();

  const onDispatched = async (opts: DispatchTaskOpts) => {
    setBusy(true);
    setError(null);
    try {
      const created = await dispatchTask(opts);
      if (!mounted.current) return;
      setDispatchOpen(false);
      setRerunFrom(null);
      setSelectedId(created.id);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(deleteTarget.id, { purge: deletePurge });
      if (!mounted.current) return;
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      setDeletePurge(false);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const requestCancel = useCallback((target: TaskRecord) => {
    setCancelError(null);
    setCancelTarget(target);
  }, []);

  const requestRerun = useCallback((target: TaskRecord) => {
    setRerunFrom(target);
    setDispatchOpen(true);
  }, []);

  const closeCancelModal = useCallback(() => {
    if (cancelBusy) return;
    setCancelTarget(null);
    setCancelError(null);
  }, [cancelBusy]);

  const onConfirmCancel = useCallback(async () => {
    if (!cancelTarget || cancelBusy) return;
    const target = cancelTarget;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelTask(target.id);
      if (!mounted.current) return;
      setCancelTarget(null);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      // 409 = already terminal; benign race — next refresh re-syncs.
      if (/409/.test(msg)) {
        setCancelTarget(null);
        await refresh();
        return;
      }
      setCancelError(msg);
    } finally {
      if (mounted.current) setCancelBusy(false);
    }
  }, [cancelTarget, cancelBusy, refresh]);

  const readyAgents = agents.filter((a) => a.status === "ready");
  const dispatchAgents = readyAgents;

  const visibleTasks = useMemo(() => {
    const q = idQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q !== "" && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, idQuery]);

  // Default-selection rule: auto-bind to the top-most visible task when
  // the URL doesn't already pin one with `?taskId=` and the list is
  // non-empty. Derived during render so it doesn't race the URL-clearing
  // path; auto-selection stays pure and cannot re-introduce cleared
  // filter params.
  //
  // Side-effect path (URL writes): only `setSelectedId` from user
  // interactions writes to the URL — the auto-fallback stays component-
  // local so `?taskId=` reflects deliberate selection, not the
  // implicit "first row".
  const effectiveSelectedId = useMemo(() => {
    if (selectedId !== null && visibleTasks.some((t) => t.id === selectedId)) {
      return selectedId;
    }
    if (loaded && visibleTasks.length > 0) return visibleTasks[0].id;
    return null;
  }, [selectedId, loaded, visibleTasks]);

  const filterAgentNames = useMemo(() => {
    const set = new Set<string>(agents.map((a) => a.agent.fqn));
    for (const t of tasks) set.add(t.agent);
    return Array.from(set).sort();
  }, [agents, tasks]);

  // True when any filter chrome is constraining the list. Used by the
  // zero-state collapse: when the workspace returns zero tasks AND no
  // filter is active, we collapse to a single full-width empty
  // (Dispatch CTA); when a filter IS active we keep the split layout
  // so the user can see and clear the filter chrome.
  const filtersActive =
    idQuery.trim() !== "" ||
    agentFilterUrl !== ALL_AGENTS ||
    runtimeFilter !== ALL_RUNTIMES ||
    timeFilter !== DEFAULT_TIME_PRESET;

  if (currentWorkspaceId === null) {
    return (
      <div className="alert alert--error">
        No workspace is selected. Use the workspace dropdown in the top bar to choose or create one
        — tasks are scoped to a workspace.
      </div>
    );
  }

  return (
    <>
      <HeaderActions>
        <TasksToolbar
          dispatchDisabled={dispatchAgents.length === 0}
          dispatchDisabledTitle={
            dispatchAgents.length === 0
              ? "Install at least one ready agent in the Catalog first"
              : "Dispatch a new task"
          }
          onDispatch={() => setDispatchOpen(true)}
        />
      </HeaderActions>

      <div className="tasks-page">
        {error && <div className="alert alert--error">⚠️ {error}</div>}

        {/* When the workspace has zero tasks and no user-set filter is
            hiding rows, collapse the split layout into a single
            full-width zero-state with a Dispatch-task CTA. The previous
            shape rendered both the list-side empty and the right-pane
            "No task selected" placeholder side-by-side, leaving a wide gap.
            When any filter is active (`?agent=`, `?runtime=`, `?range=`,
            or `?q=`), keep the normal split layout so the user sees filter-oriented no-match copy. */}
        {loaded && tasks.length === 0 && !filtersActive ? (
          <div className="tasks-pane tasks-pane--with-detail tasks-pane--zero">
            <TasksZeroState
              dispatchDisabled={dispatchAgents.length === 0}
              dispatchDisabledTitle={
                dispatchAgents.length === 0
                  ? "Install at least one ready agent in the Catalog first"
                  : "Dispatch a new task"
              }
              onDispatch={() => setDispatchOpen(true)}
            />
          </div>
        ) : (
          <div className="tasks-pane tasks-pane--with-detail">
            <div className="tasks-pane__list">
              <TaskFilters
                idQuery={idQuery}
                onIdQueryChange={setIdQuery}
                agentFilter={agentFilter}
                onAgentFilterChange={setAgentFilter}
                runtimeFilter={runtimeFilter}
                onRuntimeFilterChange={setRuntimeFilter}
                timeFilter={timeFilter}
                onTimeFilterChange={setTimeFilter}
                agents={agents}
                filterAgentNames={filterAgentNames}
                runtimes={runtimes}
                hideAgentFilter={false}
              />
              <div className="tasks-pane__list-scroll">
                {!loaded ? (
                  <TasksEmptyState loading />
                ) : visibleTasks.length === 0 ? (
                  <TasksEmptyState
                    title="No matches"
                    hint="Adjust the filters above to see more tasks."
                  />
                ) : (
                  <TaskList
                    tasks={visibleTasks}
                    selectedId={effectiveSelectedId}
                    onSelect={setSelectedId}
                    onDelete={setDeleteTarget}
                    onCancel={requestCancel}
                    onRerun={requestRerun}
                  />
                )}
              </div>
            </div>

            {effectiveSelectedId ? (
              <TaskDetail taskId={effectiveSelectedId} pollIntervalMs={pollIntervalMs} />
            ) : visibleTasks.length === 0 ? null : (
              // When the filter narrowed the list to zero rows the
              // left card already carries the full "No matches" copy;
              // rendering the detail-side "No task selected / No tasks
              // match the current filters" placeholder next to it would
              // produce two redundant empty states. We only fall
              // through to the placeholder when there ARE visible rows
              // but selection is null (in practice rare because
              // `effectiveSelectedId` auto-binds to the first row, but
              // we keep the branch for safety).
              <TaskDetailPlaceholder />
            )}
          </div>
        )}
      </div>

      <DispatchModal
        open={dispatchOpen}
        agents={dispatchAgents}
        runtimes={runtimes}
        busy={busy}
        prefill={rerunFrom}
        // Seed the modal with the page's current `?agent=` filter.
        // "All" keeps the `agents[0]` fallback; `prefill` (re-run
        // case) still wins over `initialAgent`.
        initialAgent={agentFilterUrl !== ALL_AGENTS ? agentFilterUrl : undefined}
        onClose={() => {
          setDispatchOpen(false);
          setRerunFrom(null);
        }}
        onDispatch={onDispatched}
      />

      <TaskConfirmModalsHost
        cancelTarget={cancelTarget}
        cancelBusy={cancelBusy}
        cancelError={cancelError}
        onCloseCancel={closeCancelModal}
        onConfirmCancel={onConfirmCancel}
        deleteTarget={deleteTarget}
        deleteBusy={busy}
        deletePurge={deletePurge}
        onDeletePurgeChange={setDeletePurge}
        onCloseDelete={() => {
          setDeleteTarget(null);
          setDeletePurge(false);
        }}
        onConfirmDelete={onConfirmDelete}
      />
    </>
  );
}
