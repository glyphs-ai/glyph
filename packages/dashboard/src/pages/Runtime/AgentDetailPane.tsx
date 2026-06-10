import type { AgentEntry } from "@glyphs-ai/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type CreateSessionOpts,
  createSession,
  type DispatchTaskOpts,
  dispatchTask,
  listRuntimes,
  type SessionView,
  type TaskRecord,
} from "../../api";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { AgentFqn } from "../../components/agents/AgentFqn";
import { CreateModal } from "../../components/sessions/CreateModal";
import { DispatchModal } from "../../components/tasks/DispatchModal";
import { useWorkspaceShell } from "../../components/WorkspaceShellContext";
import { splitFqnForDisplay } from "../../utils/fqn";
import { AgentOverviewTab } from "./AgentOverviewTab";
import { type AgentRuntimeStatus, AgentStatusPill } from "./agent-runtime";

export interface AgentDetailPaneProps {
  /** Canonical agent identifier (`scope/short`). */
  fqn: string;
  /**
   * Catalog entry for the agent, or `null` when the fqn doesn't match any
   * installed agent in the current workspace (e.g. stale link, uninstalled
   * by another tab). When null the pane renders the "not installed" alert
   * in place of the Overview tab, but still renders the title/avatar/KPIs
   * so a refresh-on-the-fly install resolves cleanly.
   */
  entry: AgentEntry | null;
  /** Workspace UUID used to build the per-agent deep links. */
  workspaceId: string;
  /**
   * Tasks for this agent (lifted from the inner Overview tab so the
   * header KPI tiles and the inner cells share one source of truth).
   * `null` while the first fetch is in flight.
   */
  tasks: TaskRecord[] | null;
  /** Sessions for this agent — same lifecycle as `tasks`. */
  sessions: SessionView[] | null;
  /** Latest fetch error for tasks (kept after the last successful list so it surfaces once). */
  tasksError: string | null;
  /** Latest fetch error for sessions — same shape. */
  sessionsError: string | null;
}

/**
 * Pure-presentational right-pane of the master-detail Agents page.
 *
 * The master Agents page mounts this chrome inline (avatar + name/scope
 * + status pill + version + actions + KPI row + Overview tab) and owns
 * the polling that supplies the resolved `tasks` / `sessions` arrays.
 *
 * The "+ New task" and "+ New session" buttons mount their modals
 * locally with `initialAgent={fqn}` so the user stays in the agent's
 * context while creating work. Successful dispatch / create relies on
 * the parent page's poll loop to surface the new row in Recent tasks /
 * Active sessions; this pane owns no refresh signal beyond closing the
 * modal.
 */
export function AgentDetailPane({
  fqn,
  entry,
  workspaceId,
  tasks,
  sessions,
  tasksError,
  sessionsError,
}: AgentDetailPaneProps) {
  const { data, config } = useWorkspaceShell();

  const { scope, shortName } = useMemo(() => splitFqnForDisplay(fqn), [fqn]);

  const status: AgentRuntimeStatus = tasks?.some((t) => t.status === "running")
    ? "running"
    : "idle";

  // KPI totals — derived during render so re-fetches drive them immediately.
  const kpis = useMemo(() => {
    const runningTasks = tasks?.filter((t) => t.status === "running").length ?? 0;
    const totalTasks = tasks?.length ?? 0;
    const sessionsCount = sessions?.length ?? 0;
    return { runningTasks, totalTasks, sessionsCount };
  }, [tasks, sessions]);

  const sessionsUrl = `/workspaces/${encodeURIComponent(workspaceId)}/runtime/sessions?agent=${fqn}`;
  const tasksUrl = `/workspaces/${encodeURIComponent(workspaceId)}/runtime/tasks?agent=${fqn}`;
  // Catalog has no per-agent route today — link to the agents tab with an
  // `?agent=` hint so the catalog page scrolls/highlights the matching row.
  const configureUrl = `/workspaces/${encodeURIComponent(workspaceId)}/catalog/agents?agent=${fqn}`;

  // ─── In-place modal state ─────────────────────
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<string[]>([]);

  // Reset pane-local state when the master list switches to a
  // different agent. The master-detail layout mounts this pane at a
  // single JSX position and only swaps `fqn`, so React reconciles the
  // same component instance across selections — without an explicit
  // reset, agent A's `actionError` banner, in-flight `busy` spinner,
  // and open dispatch/create modals would bleed into agent B's pane
  // after the user picks a new row.
  //
  // Deps must stay `[fqn]` only: any unrelated re-render (parent poll
  // tick, runtimes resolve) must NOT clobber valid in-progress state
  // (e.g. an error banner the user is still reading, or an open modal
  // mid-edit). The setters are stable React identities and intentionally
  // omitted from the deps list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate fqn-only reset
  useEffect(() => {
    setActionError(null);
    setBusy(false);
    setDispatchOpen(false);
    setCreateOpen(false);
  }, [fqn]);
  // Runtimes are static for a given server process; fetch once when the
  // pane mounts (i.e. when the user actually picks an agent). Failures are
  // non-fatal: the modals fall back to `(server default)` if the registry
  // can't be reached.
  useEffect(() => {
    let cancelled = false;
    listRuntimes()
      .then((rts) => {
        if (!cancelled) setRuntimes(rts.map((r) => r.kind));
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dispatchAgents = useMemo(
    () => data.agents.filter((a) => a.status === "ready"),
    [data.agents],
  );

  const onDispatch = useCallback(async (opts: DispatchTaskOpts) => {
    setBusy(true);
    setActionError(null);
    try {
      await dispatchTask(opts);
      // The parent page's poll loop (workspace-wide tasks fetch) will
      // surface the new row in Recent tasks on its next tick. No
      // refresh hook needed here; just close the modal.
      setDispatchOpen(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onCreateSession = useCallback(async (opts: CreateSessionOpts) => {
    setBusy(true);
    setActionError(null);
    try {
      await createSession(opts);
      // Parent page's per-agent sessions poll surfaces the new row.
      setCreateOpen(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <aside
      className="tasks-pane__detail agent-detail-pane"
      data-testid="agent-detail-pane"
      data-agent-fqn={fqn}
    >
      <header className="agent-detail__header">
        <div className="agent-detail__title-row">
          <AgentAvatar fqn={fqn} label={shortName} size="lg" />
          <div className="agent-detail__name-block">
            <h2 className="agent-detail__title">
              <AgentFqn fqn={fqn} as="span" />
            </h2>
            <span className="agent-detail__scope muted">{scope}</span>
          </div>
          <AgentStatusPill status={status} />
          {entry && <span className="agent-detail__version muted">v{entry.agent.version}</span>}
          <span className="agent-detail__spacer" />
          <div className="agent-detail__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setDispatchOpen(true)}
              disabled={!entry || dispatchAgents.length === 0}
              title={
                !entry
                  ? "This agent is not installed in this workspace"
                  : dispatchAgents.length === 0
                    ? "Install at least one ready agent in the Catalog first"
                    : "Dispatch a task for this agent"
              }
              data-testid="agent-detail-new-task"
            >
              + New task
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setCreateOpen(true)}
              disabled={!entry || dispatchAgents.length === 0}
              title={
                !entry
                  ? "This agent is not installed in this workspace"
                  : dispatchAgents.length === 0
                    ? "Install at least one ready agent in the Catalog first"
                    : "Create a session for this agent"
              }
              data-testid="agent-detail-new-session"
            >
              + New session
            </button>
            <Link to={configureUrl} className="btn btn--ghost" data-testid="agent-detail-configure">
              Configure
            </Link>
          </div>
        </div>
        <div className="agent-detail__kpis" data-testid="agent-detail-kpis">
          <KpiTile label="Running tasks" value={kpis.runningTasks} caption="live" />
          <KpiTile label="Total tasks (7d)" value={kpis.totalTasks} caption="dispatched" />
          <KpiTile label="Sessions (7d)" value={kpis.sessionsCount} caption="recorded" />
        </div>
      </header>

      {actionError && (
        <div className="alert alert--error" data-testid="agent-detail-action-error">
          ⚠️ {actionError}
        </div>
      )}

      {!entry ? (
        <div className="alert alert--error">
          Agent <code>{fqn}</code> is not installed in this workspace. It may have been removed via
          Catalog.
        </div>
      ) : (
        <AgentOverviewTab
          fqn={fqn}
          tasks={tasks}
          sessions={sessions}
          tasksError={tasksError}
          sessionsError={sessionsError}
          sessionsUrl={sessionsUrl}
          tasksUrl={tasksUrl}
        />
      )}

      {/* In-place modals. Both pre-seed their agent
          dropdown with `initialAgent={fqn}` so the user stays in the
          agent's context while creating new work. Silent fallback to
          `agents[0]` when fqn isn't in `agents` (e.g. an uninstalled
          agent whose `?selected=` is still in the URL) — the modal
          doesn't surface "not installed" alerts; the pane's body already
          does that above. */}
      <DispatchModal
        open={dispatchOpen}
        agents={dispatchAgents}
        runtimes={runtimes}
        busy={busy}
        prefill={null}
        initialAgent={fqn}
        onClose={() => setDispatchOpen(false)}
        onDispatch={onDispatch}
      />
      <CreateModal
        open={createOpen}
        agents={dispatchAgents}
        runtimes={runtimes}
        workspaceDisplayName={null}
        pathSeparator={config?.pathSeparator ?? "/"}
        busy={busy}
        initialAgent={fqn}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateSession}
      />
    </aside>
  );
}

interface KpiTileProps {
  label: string;
  value: number;
  caption: string;
}

function KpiTile({ label, value, caption }: KpiTileProps) {
  return (
    <div className="kpi-tile">
      <div className="kpi-tile__label">{label}</div>
      <div className="kpi-tile__value">{value}</div>
      <div className="kpi-tile__caption muted">{caption}</div>
    </div>
  );
}
