import type { AgentEntry } from "@glyphs-ai/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  cancelWorkflow,
  deleteWorkflow,
  type ServerConfig,
  type WorkflowHeader,
  type WorkflowNode,
} from "../api";
import { EmptyState } from "../components/common/EmptyState";
import { resolveListPageState } from "../components/common/listPageState";
import { HeaderActions } from "../components/HeaderActions";
import { PlusIcon } from "../components/Icons";
import {
  ALL_AGENTS,
  coerceTimePreset,
  DEFAULT_TIME_PRESET,
  isTimeFilterActive,
  type TimePreset,
} from "../components/tasks/shared";
import { CreateWorkflowModal } from "../components/workflows/CreateWorkflowModal";
import {
  CancelWorkflowModal,
  DeleteWorkflowModal,
} from "../components/workflows/WorkflowConfirmModals";
import { WorkflowDetailSkeleton } from "../components/workflows/WorkflowDetailSkeleton";
import { WorkflowFilters } from "../components/workflows/WorkflowFilters";
import { WorkflowList } from "../components/workflows/WorkflowList";
import { WorkflowListSkeleton } from "../components/workflows/WorkflowListSkeleton";
import { useMounted } from "../hooks/useMounted";
import { useUrlSearchValue } from "../hooks/useUrlState";
import { useWorkflowDetail } from "../hooks/useWorkflowDetail";
import { useWorkflows } from "../hooks/useWorkflows";
import { WorkflowDetail } from "./workflows/WorkflowDetail";
import { WorkflowNodeHumanPane } from "./workflows/WorkflowNodeHumanPane";
import { WorkflowNodeTaskPane } from "./workflows/WorkflowNodeTaskPane";

export interface WorkflowsPageProps {
  agents: AgentEntry[];
  /** UUID of the workspace currently in scope (from the URL); null = no workspace. */
  currentWorkspaceId: string | null;
  /**
   * Server-supplied config; null while still being fetched. Supplies
   * the Mode B per-task poll interval so the value matches the
   * Tasks page (`config.tasks.pollIntervalMs`) instead of drifting on
   * a Workflows-local constant.
   */
  config?: ServerConfig | null;
}

const DEFAULT_NODE_TASK_POLL_INTERVAL_MS = 4000;

/**
 * Workflows page — workspace-scoped master-detail view for the
 * `@glyphs-ai/workflow` substrate.
 *
 * URL-driven state machine (mirrors the Tasks page slot-for-slot):
 *
 *   - `?q=<idFragment>`   — substring search on the workflow id
 *   - `?agent=<fqn>`      — coordinator-agent filter (`ALL_AGENTS`
 *     sentinel = no filter)
 *   - `?range=today|7d|30d|all` — time-preset filter on `createdAt`
 *   - `?workflowId=<wfid>`     — master-detail selection
 *   - `?nodeTaskId=<taskId>`   — Mode B drill-down (right pane swaps
 *     from the {@link WorkflowDetail} tab host to the full
 *     {@link WorkflowNodeTaskPane})
 *
 * The prior `?status=` slot was retired in favour of client-side
 * Running/Completed grouping in the list; a stale `?status=` slot in
 * old links is ignored gracefully (no read, no redirect).
 *
 * When `nodeTaskId` is present, the right pane is the node-task drill
 * (with a header pill walking the workflow's nodes in execution
 * order). When it's absent, the right pane is the standard 3-tab
 * `WorkflowDetail`. Tab state is component-local and does NOT
 * round-trip through the URL.
 */
export function WorkflowsPage({ agents, currentWorkspaceId, config }: WorkflowsPageProps) {
  const nodeTaskPollIntervalMs =
    config?.tasks?.pollIntervalMs ?? DEFAULT_NODE_TASK_POLL_INTERVAL_MS;
  const navigate = useNavigate();
  const location = useLocation();

  // URL-driven filter state — same slots + shape as Tasks.tsx.
  const [idQuery, setIdQuery] = useUrlSearchValue("q", "");
  const [agentFilter, setAgentFilter] = useUrlSearchValue("agent", ALL_AGENTS);
  const [rangeUrl, setRangeUrl] = useUrlSearchValue("range", DEFAULT_TIME_PRESET);
  const timeFilter = coerceTimePreset(rangeUrl);
  const setTimeFilter = (v: TimePreset) => setRangeUrl(v);

  const [selectedIdRaw] = useUrlSearchValue("workflowId", "");
  const [nodeTaskIdRaw] = useUrlSearchValue("nodeTaskId", "");
  const [humanNodeIdRaw] = useUrlSearchValue("humanNodeId", "");
  const selectedId = selectedIdRaw === "" ? null : selectedIdRaw;
  const nodeTaskId = nodeTaskIdRaw === "" ? null : nodeTaskIdRaw;
  const humanNodeId = humanNodeIdRaw === "" ? null : humanNodeIdRaw;

  // Atomic URL writer: updates `workflowId`, `nodeTaskId`, and
  // `humanNodeId` in a single `navigate()` call so two sequential
  // single-key setters can't race via stale `location.search`
  // snapshots. Pass `undefined` to leave a key untouched, empty
  // string / null to delete it.
  const setMasterDetailUrl = useCallback(
    (next: {
      workflowId?: string | null;
      nodeTaskId?: string | null;
      humanNodeId?: string | null;
    }) => {
      const params = new URLSearchParams(location.search);
      if (next.workflowId !== undefined) {
        if (next.workflowId === null || next.workflowId === "") params.delete("workflowId");
        else params.set("workflowId", next.workflowId);
      }
      if (next.nodeTaskId !== undefined) {
        if (next.nodeTaskId === null || next.nodeTaskId === "") params.delete("nodeTaskId");
        else params.set("nodeTaskId", next.nodeTaskId);
      }
      if (next.humanNodeId !== undefined) {
        if (next.humanNodeId === null || next.humanNodeId === "") params.delete("humanNodeId");
        else params.set("humanNodeId", next.humanNodeId);
      }
      const search = params.toString();
      navigate(`${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`, {
        replace: true,
      });
    },
    [navigate, location.pathname, location.search, location.hash],
  );

  const { workflows, loaded, error, setError, refresh, historicalAgentNames } = useWorkflows({
    currentWorkspaceId,
    idQuery,
    agentFilter,
    timeFilter,
  });

  // Atomic "Clear filters" reset. The selection keys (`workflowId`,
  // `nodeTaskId`, `humanNodeId`) are intentionally preserved so clearing
  // filters is non-destructive to the open detail view. The time range is
  // widened to "all" (not merely deleted, which would fall back to the
  // bounded default) so clearing actually surfaces workflows that predate
  // the default window.
  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete("q");
    params.delete("agent");
    params.set("range", "all");
    const search = params.toString();
    navigate(`${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`, {
      replace: true,
    });
  }, [navigate, location.pathname, location.search, location.hash]);

  const visible = workflows;

  // Coordinator-agent dropdown population. Derived from the current
  // `workflows` rows' `coordinatorAgent` field rather than the global
  // `agents` catalogue: there is no catalog-level flag on agents
  // declaring "I am a coordinator", so the operational answer is
  // "any agent that has actually run as a coordinator in this
  // workspace". The set unions three sources so the dropdown stays
  // useful while a narrow filter is active:
  //
  //   1. agents present in the currently-visible rows (the live set)
  //   2. agents observed in earlier agent-unfiltered fetches this
  //      session (`historicalAgentNames` from `useWorkflows`) — this
  //      is what lets the operator switch from agent A to agent B
  //      in one click even when filtering by A has narrowed the
  //      visible set to A-only
  //   3. the currently-selected filter value itself (defensive: keep
  //      the user's own selection in the list even if no historical
  //      or live row matches it)
  const filterAgentNames = useMemo(() => {
    const set = new Set<string>();
    for (const w of workflows) set.add(w.coordinatorAgent);
    for (const name of historicalAgentNames) set.add(name);
    if (agentFilter !== ALL_AGENTS) set.add(agentFilter);
    return Array.from(set).sort();
  }, [workflows, historicalAgentNames, agentFilter]);

  const effectiveSelectedId =
    selectedId !== null && visible.some((w) => w.id === selectedId)
      ? selectedId
      : loaded && visible.length > 0
        ? (visible[0]?.id ?? null)
        : null;

  const detail = useWorkflowDetail(effectiveSelectedId);

  // Compute the selected node id for the Graph tab's highlight. When
  // Mode B is active (`nodeTaskId` or `humanNodeId` set), map it back
  // to a node id via the dag. A dag that hasn't loaded yet keeps the
  // selection null so the chip just renders un-styled.
  const selectedNodeId = useMemo(() => {
    if (humanNodeId !== null) return humanNodeId;
    if (nodeTaskId !== null && detail.dag !== null) {
      return detail.dag.nodes.find((n) => n.taskId === nodeTaskId)?.id ?? null;
    }
    return null;
  }, [humanNodeId, nodeTaskId, detail.dag]);

  // Master selection write: clears any in-flight Mode B at the same
  // time so the right pane never falls into the inconsistent state
  // "workflow A's header + workflow B's nodeTaskId."
  const onSelectWorkflow = useCallback(
    (id: string | null) => {
      setMasterDetailUrl({ workflowId: id, nodeTaskId: null, humanNodeId: null });
    },
    [setMasterDetailUrl],
  );

  // Mode B entry: parent renders the appropriate pane on the right.
  // Human nodes use `humanNodeId`; task-backed nodes use `nodeTaskId`.
  const onSelectNode = useCallback(
    (node: WorkflowNode) => {
      if (node.spec.kind === "human") {
        setMasterDetailUrl({ nodeTaskId: null, humanNodeId: node.id });
      } else {
        if (node.taskId === undefined) return;
        setMasterDetailUrl({ nodeTaskId: node.taskId, humanNodeId: null });
      }
    },
    [setMasterDetailUrl],
  );

  const onBackToWorkflow = useCallback(() => {
    setMasterDetailUrl({ nodeTaskId: null, humanNodeId: null });
  }, [setMasterDetailUrl]);

  const onNavigateNode = useCallback(
    (nextTaskId: string) => {
      setMasterDetailUrl({ nodeTaskId: nextTaskId, humanNodeId: null });
    },
    [setMasterDetailUrl],
  );

  const onNavigateHumanNode = useCallback(
    (nextNodeId: string) => {
      // Determine if the target node is a human or task node
      const target = detail.dag?.nodes.find((n) => n.id === nextNodeId);
      if (target?.spec.kind === "human") {
        setMasterDetailUrl({ humanNodeId: nextNodeId, nodeTaskId: null });
      } else if (target?.taskId) {
        setMasterDetailUrl({ nodeTaskId: target.taskId, humanNodeId: null });
      }
    },
    [setMasterDetailUrl, detail.dag],
  );

  const mounted = useMounted();
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<WorkflowHeader | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowHeader | null>(null);
  const [deletePurge, setDeletePurge] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Single-open coordination for the per-row `⋯` action menus
  // (mirrors `Schedules.tsx`). At most one row's menu may be open at
  // a time so the panels don't visually overlap or fight for focus.
  const [openMenuWorkflowId, setOpenMenuWorkflowId] = useState<string | null>(null);

  const handleRowCancel = useCallback((target: WorkflowHeader) => {
    // Row menu invokes Cancel: drop the menu, open the modal targeted
    // at the row's workflow. Doesn't change the master selection —
    // the user may cancel a non-selected workflow.
    setOpenMenuWorkflowId(null);
    setCancelError(null);
    setCancelTarget(target);
  }, []);

  const handleRowDelete = useCallback((target: WorkflowHeader) => {
    // Row menu invokes Delete: drop the menu, open the modal targeted
    // at the row's workflow. Independent of master selection so any
    // terminal workflow can be deleted in-place.
    setOpenMenuWorkflowId(null);
    setDeleteError(null);
    setDeletePurge(false);
    setDeleteTarget(target);
  }, []);

  const handleCreated = useCallback(
    (created: WorkflowHeader) => {
      setError(null);
      setMasterDetailUrl({ workflowId: created.id, nodeTaskId: null, humanNodeId: null });
      // Best-effort: refresh the list so the new row is sourced from
      // the server rather than synthesised on the client. Status
      // grouping puts the freshly-`running` row in the Running
      // section by construction, so no filter reset is needed (the
      // active filters are search / agent / time, none of which hide
      // a brand-new row by default).
      void refresh();
    },
    [refresh, setError, setMasterDetailUrl],
  );

  const handleConfirmCancel = useCallback(
    async (reason: string) => {
      if (!cancelTarget) return;
      setCancelBusy(true);
      setCancelError(null);
      try {
        await cancelWorkflow(cancelTarget.id, {
          cancellation: { kind: "user", message: reason },
        });
        if (!mounted.current) return;
        setCancelTarget(null);
        await refresh();
        await detail.refresh();
      } catch (e) {
        if (!mounted.current) return;
        setCancelError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setCancelBusy(false);
      }
    },
    [cancelTarget, detail, refresh],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteWorkflow(deleteTarget.id, { purge: deletePurge });
      if (!mounted.current) return;
      // If the deleted workflow was the master selection, clear the
      // URL slot so the detail pane doesn't try to fetch a now-404
      // workflow header. The reconcile useEffect would also catch
      // this on the next refresh tick, but clearing inline avoids
      // the transient "workflow not found" alert.
      if (effectiveSelectedId === deleteTarget.id) {
        setMasterDetailUrl({ workflowId: null, nodeTaskId: null, humanNodeId: null });
      }
      setDeleteTarget(null);
      setDeletePurge(false);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setDeleteBusy(false);
    }
  }, [deleteTarget, deletePurge, effectiveSelectedId, refresh, setMasterDetailUrl]);

  // When the selected workflow ends, surface the freshly-terminal row
  // by pulling the server state once more so the row's row-tint stops
  // pulsing without waiting for the next list-polling tick.
  useEffect(() => {
    if (detail.workflow === null) return;
    if (detail.workflow.status === "running") return;
    if (visible.some((w) => w.id === detail.workflow?.id && w.status !== detail.workflow.status)) {
      void refresh();
    }
  }, [detail.workflow, visible, refresh]);

  if (currentWorkspaceId === null) {
    return (
      <div className="alert alert--error">
        No workspace is selected. Use the workspace dropdown in the top bar to choose or create one
        — workflows are scoped to a workspace.
      </div>
    );
  }

  const filtersActive =
    idQuery !== "" || agentFilter !== ALL_AGENTS || isTimeFilterActive(timeFilter);
  // Shared empty-state machine: Loading | Zero | No-match | Unselected |
  // Normal. `workflows` is already server-filtered (by `createdSince` among
  // others), so its length is both the item count and the visible count.
  // The genuinely-empty workspace ("zero") is split from a filter-narrowed
  // result ("nomatch") via `filtersActive` — and because a bounded time
  // window counts as an active filter, a populated-but-stale workspace
  // (every workflow older than the window) resolves to "nomatch" with a
  // working Clear-filters recovery rather than the misleading "zero" state.
  const workflowsState = resolveListPageState({
    loaded,
    itemCount: workflows.length,
    filtersActive,
    visibleCount: visible.length,
    effectiveSelectedId,
  });
  const detailWorkflow = detail.workflow;
  const showNodeTaskPane = nodeTaskId !== null && effectiveSelectedId !== null;
  const showHumanNodePane = humanNodeId !== null && effectiveSelectedId !== null;

  return (
    <>
      <HeaderActions>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreateOpen(true)}
          disabled={agents.length === 0}
          title={
            agents.length === 0
              ? "Install at least one agent in the Catalog before creating workflows"
              : "Create a new workflow"
          }
          data-testid="workflows-new-cta"
        >
          <PlusIcon />
          <span>New workflow</span>
        </button>
      </HeaderActions>

      <div className="tasks-page">
        {error && <div className="alert alert--error">⚠️ {error}</div>}
        <div className="tasks-pane tasks-pane--with-detail">
          <div className="tasks-pane__list">
            <WorkflowFilters
              idQuery={idQuery}
              onIdQueryChange={setIdQuery}
              agentFilter={agentFilter}
              onAgentFilterChange={setAgentFilter}
              timeFilter={timeFilter}
              onTimeFilterChange={setTimeFilter}
              filterAgentNames={filterAgentNames}
            />
            <div className="tasks-pane__list-scroll">
              {workflowsState === "loading" ? (
                <WorkflowListSkeleton />
              ) : workflowsState === "zero" || workflowsState === "nomatch" ? null : (
                <WorkflowList
                  workflows={visible}
                  selectedId={effectiveSelectedId}
                  onSelect={onSelectWorkflow}
                  onCancel={handleRowCancel}
                  onDelete={handleRowDelete}
                  openMenuId={openMenuWorkflowId}
                  onMenuOpenChange={setOpenMenuWorkflowId}
                />
              )}
            </div>
          </div>

          {(() => {
            // `!= null` (loose) rather than `!== null` (strict) so an
            // out-of-contract `undefined` from a buggy mock or server
            // falls through to the
            // `<WorkflowDetailSkeleton />` branch instead of being
            // handed to `<WorkflowView>` (which dereferences
            // `workflow.brief` and crashes the root). The hook's
            // typed shape is `WorkflowHeader | null`, but
            // accepting `undefined` here keeps the page robust
            // against contract violations.
            if (showNodeTaskPane && detailWorkflow != null) {
              return (
                <WorkflowNodeTaskPane
                  key={`${effectiveSelectedId}:${nodeTaskId}`}
                  workflow={detailWorkflow}
                  dag={detail.dag}
                  nodeTaskId={nodeTaskId as string}
                  pollIntervalMs={nodeTaskPollIntervalMs}
                  onBack={onBackToWorkflow}
                  onNavigate={onNavigateNode}
                />
              );
            }
            if (showHumanNodePane && detailWorkflow != null) {
              return (
                <WorkflowNodeHumanPane
                  key={`${effectiveSelectedId}:human:${humanNodeId}`}
                  workflow={detailWorkflow}
                  dag={detail.dag}
                  nodeId={humanNodeId as string}
                  onBack={onBackToWorkflow}
                  onNavigate={onNavigateHumanNode}
                />
              );
            }
            // Initial list load: keep the detail pane skeletonised too,
            // rather than flashing the "No workflow selected" placeholder
            // before the auto-selected first row resolves.
            if (workflowsState === "loading") {
              return <WorkflowDetailSkeleton />;
            }
            if (workflowsState === "zero") {
              return (
                <EmptyState
                  asDetailPane
                  icon="🪄"
                  title="No workflows yet"
                  hint={
                    <>
                      Click <strong>New workflow</strong> to dispatch a coordinator-driven
                      multi-step run. The coordinator decides which task and follow-up coordinator
                      nodes to spawn next — each phase wakes the next one when the previous worker
                      terminates.
                    </>
                  }
                  testId="workflows-empty-zero"
                  cta={{
                    label: "New workflow",
                    onClick: () => setCreateOpen(true),
                    icon: <PlusIcon />,
                    disabled: agents.length === 0,
                    disabledTitle:
                      agents.length === 0
                        ? "Install at least one agent in the Catalog before creating workflows"
                        : "Create a new workflow",
                    testId: "workflows-empty-zero-cta",
                  }}
                />
              );
            }
            if (workflowsState === "nomatch") {
              return (
                <EmptyState
                  asDetailPane
                  icon="🔍"
                  title="No matches"
                  hint="Adjust the filters above to see more workflows, or clear them all."
                  testId="workflows-empty-nomatch"
                  cta={{
                    label: "Clear filters",
                    onClick: clearFilters,
                    variant: "secondary",
                    testId: "workflows-empty-nomatch-cta",
                  }}
                />
              );
            }
            if (effectiveSelectedId !== null && detailWorkflow != null) {
              return (
                <WorkflowDetail
                  key={effectiveSelectedId}
                  workflow={detailWorkflow}
                  dag={detail.dag}
                  dagError={detail.dagError}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
              );
            }
            if (effectiveSelectedId !== null && detail.error !== null) {
              return (
                <aside className="tasks-pane__detail tasks-pane__detail--empty">
                  <div className="alert alert--error">⚠️ {detail.error}</div>
                </aside>
              );
            }
            if (effectiveSelectedId !== null) {
              return <WorkflowDetailSkeleton />;
            }
            return <EmptyState asDetailPane icon="🪄" title="No workflow selected" />;
          })()}
        </div>
      </div>

      {createOpen && (
        <CreateWorkflowModal
          open={createOpen}
          agents={agents}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {cancelTarget && (
        <CancelWorkflowModal
          target={cancelTarget}
          busy={cancelBusy}
          error={cancelError}
          onClose={() => {
            if (cancelBusy) return;
            setCancelTarget(null);
            setCancelError(null);
          }}
          onConfirm={handleConfirmCancel}
        />
      )}

      {deleteTarget && (
        <DeleteWorkflowModal
          target={deleteTarget}
          purge={deletePurge}
          onPurgeChange={setDeletePurge}
          busy={deleteBusy}
          error={deleteError}
          onClose={() => {
            if (deleteBusy) return;
            setDeleteTarget(null);
            setDeleteError(null);
            setDeletePurge(false);
          }}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
