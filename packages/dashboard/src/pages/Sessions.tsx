import type { AgentEntry } from "@glyphs-ai/sdk";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type CreateSessionOpts,
  createSession,
  deleteSession,
  listRuntimes,
  listSessions,
  type ServerConfig,
  type SessionView,
  spawnSession,
  type WorkspaceListItem,
} from "../api";
import { HeaderActions } from "../components/HeaderActions";
import { PlusIcon, RefreshIcon } from "../components/Icons";
import { Modal } from "../components/Modal";
import { CreateModal } from "../components/sessions/CreateModal";
import { DeleteModalBody } from "../components/sessions/DeleteModalBody";
import { FallbackModalBody } from "../components/sessions/FallbackModalBody";
import { SessionListItem } from "../components/sessions/SessionListItem";
import { useMounted } from "../hooks/useMounted";
import { useUrlSearchValue } from "../hooks/useUrlState";
import { serverNow } from "../server-clock";

interface SessionsProps {
  agents: AgentEntry[];
  config: ServerConfig | null;
  /** UUID of the workspace currently in scope (from the URL); null = no workspace. */
  currentWorkspaceId: string | null;
  /** Full registered-workspace list, used to resolve display name for the workdir hint. */
  workspaces: WorkspaceListItem[];
}

interface FallbackInfo {
  display: string;
  reason: string;
}

interface DeleteModalState {
  session: SessionView;
  /**
   * `true` = purge mode: also wipe the workdir and the runtime adapter's
   * per-session state. `false` = archive (default): only the metadata
   * row is removed; workdir + runtime state are preserved on disk.
   */
  purge: boolean;
}

const ALL_AGENTS = "__all__";
const ALL_RUNTIMES = "__all__";

const TIME_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
] as const;
type TimePreset = (typeof TIME_PRESETS)[number]["value"];

const DEFAULT_TIME_PRESET: TimePreset = "7d";

/**
 * Convert a preset to an ISO 8601 lower bound for the **lastActiveAt**
 * filter. "Most recent activity" matches the UX of chat / messaging
 * apps and is what users mean when they pick "Today" or "7d".
 *
 * Anchored on `now` (defaults to `serverNow()` from `../server-clock`)
 * so cutoffs are computed against the **server's** clock, not the
 * user's laptop. Without this, a clock-skewed laptop can hide today's
 * sessions behind a future-dated "today" cutoff or include yesterday's
 * with a stale one.
 *
 * Sessions that have never been launched (`lastActiveAt === null`) are
 * excluded by any non-`all` preset — by definition they have no
 * activity to be recent.
 */
function presetToActiveSince(preset: TimePreset, now: Date = serverNow()): string | undefined {
  switch (preset) {
    case "today": {
      // Local-time midnight. The server compares ISO strings, so we send the
      // resulting UTC moment as Z-suffixed ISO.
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    case "7d":
      return new Date(now.getTime() - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 86_400_000).toISOString();
    case "all":
      return undefined;
  }
}

/**
 * Sessions page — lists per-session workdirs managed by the runtime registry
 * and lets the user create, launch, and delete them. The Launch button asks
 * the server to spawn the user's terminal directly. If spawning fails (e.g.
 * no terminal emulator could be detected), we fall back to showing the
 * incantation in a modal so the user can still copy-paste it.
 */
export function SessionsPage({ agents, config, currentWorkspaceId, workspaces }: SessionsProps) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [runtimes, setRuntimes] = useState<string[]>([]);

  // URL-driven filter state. Each filter
  // reads from its querystring slot and writes back via the guarded
  // setter from {@link useUrlSearchValue}, so refresh / back-button /
  // share-link all reproduce the same view.
  const [idQuery, setIdQuery] = useUrlSearchValue("q", "");
  const [agentFilterUrl, setAgentFilterUrl] = useUrlSearchValue("agent", ALL_AGENTS);
  const [runtimeFilter, setRuntimeFilter] = useUrlSearchValue("runtime", ALL_RUNTIMES);
  const [rangeUrl, setRangeUrl] = useUrlSearchValue("range", DEFAULT_TIME_PRESET);
  const filter = agentFilterUrl;
  const setFilter = setAgentFilterUrl;
  // Coerce the URL value to a known preset so a stale or malformed
  // querystring (`?range=lastQuarter`) silently degrades to the
  // default instead of breaking the data fetch.
  const timeFilter: TimePreset = ((): TimePreset => {
    const match = TIME_PRESETS.find((p) => p.value === rangeUrl);
    return match ? match.value : DEFAULT_TIME_PRESET;
  })();
  const setTimeFilter = (v: TimePreset) => setRangeUrl(v);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Distinguishes "haven't loaded yet" from "loaded with zero results" so the
  // initial mount shows a spinner instead of the misleading "No sessions yet"
  // empty state for however long the first GET takes.
  const [loaded, setLoaded] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fallback, setFallback] = useState<FallbackInfo | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);

  // Pre-select a row when the user clicked one in the agent's Overview
  // tab. The session id arrives via `location.state`; consume it once
  // on mount, then clear history state so back/forward navigation does
  // not re-fire the highlight.
  const location = useLocation();
  const navigate = useNavigate();
  const initialPreselectSessionId =
    typeof location.state === "object" && location.state !== null
      ? (((location.state as { preselectSessionId?: unknown }).preselectSessionId as
          | string
          | undefined) ?? null)
      : null;
  const [preselectedSessionId, setPreselectedSessionId] = useState<string | null>(
    initialPreselectSessionId,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount; navigate/location read intentionally only on first render
  useEffect(() => {
    if (initialPreselectSessionId === null) return;
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, []);

  // Tracks whether the component is still mounted so async handlers can
  // skip setState calls on a tombstoned instance. See `useMounted` for the
  // StrictMode-safe re-init rationale.
  const mounted = useMounted();

  const refresh = async () => {
    if (!currentWorkspaceId) {
      setSessions([]);
      setLoaded(true);
      return;
    }
    try {
      const next = await listSessions({
        agent: filter === ALL_AGENTS ? undefined : filter,
        activeSince: presetToActiveSince(timeFilter),
      });
      if (!mounted.current) return;
      setError(null);
      setSessions(next);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) {
        setLoaded(true);
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh defined inline; runs on filter/timeFilter/workspace change
  useEffect(() => {
    refresh();
  }, [filter, timeFilter, currentWorkspaceId]);

  // Refresh when the tab becomes visible after being hidden. Sessions don't
  // auto-poll (unlike Tasks), so this is the single auto-refresh path that
  // covers "I came back to the dashboard after a while" without spamming the
  // server with periodic polls.
  //
  // `refresh` is declared inline every render and closes over `filter`,
  // `timeFilter`, and `currentWorkspaceId`. To avoid resubscribing the
  // visibilitychange listener on every render — while still always invoking
  // the *latest* closure (with current filters/workspace) — we stash it in a
  // ref and read `refreshRef.current` from the stable listener.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refreshRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Fetch the registered runtimes once at mount; the registry is static
  // for a given server process so we don't need to re-poll.
  useEffect(() => {
    let cancelled = false;
    listRuntimes()
      .then((rts) => {
        if (!cancelled) setRuntimes(rts.map((r) => r.kind));
      })
      .catch(() => {
        // Non-fatal: CreateModal falls back to omitting the runtime field,
        // which makes the server pick its default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCreated = async (opts: CreateSessionOpts) => {
    setBusy(true);
    setError(null);
    try {
      await createSession(opts);
      if (!mounted.current) return;
      setCreateOpen(false);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const onLaunch = async (s: SessionView, opts: { remote?: boolean } = {}) => {
    if (launchingId !== null) return;
    setLaunchingId(s.id);
    setError(null);
    try {
      // Resume vs fresh is decided by the runtime now: if a runtimeSessionId
      // is persisted, buildInteractiveLaunch will produce a `--session-id=<id>` form; if not,
      // it produces a bare launch. Either way the dashboard just asks to spawn.
      // `opts.remote` selects between the two spawn buttons in the row;
      // server validates against the runtime's capabilities and 400s if
      // unsupported (defensive — disabled buttons in the UI are the
      // first line of defence).
      const result = await spawnSession(s.id, opts);
      if (!mounted.current) return;
      if (!result.ok) {
        // Server returned 200 but couldn't spawn a terminal — show the
        // command so the user can paste it into their own shell.
        setFallback({ display: result.display, reason: result.error });
      }
      // Refresh after a successful launch so lastActiveAt/preview update.
      if (result.ok) {
        if (!mounted.current) return;
        await refresh();
      }
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLaunchingId(null);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteModal) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSession(deleteModal.session.id, { purge: deleteModal.purge });
      if (!mounted.current) return;
      setDeleteModal(null);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const readyAgents = agents.filter((a) => a.status === "ready");
  const createAgents = readyAgents;

  // Client-side filters layered on top of the server-side agent narrow.
  // Both are interactive (typing / dropdown change), so doing them in-memory
  // avoids a round-trip per keystroke and keeps the UI snappy.
  const visibleSessions = (() => {
    const q = idQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (q !== "" && !s.id.toLowerCase().includes(q)) return false;
      if (runtimeFilter !== ALL_RUNTIMES && s.runtime !== runtimeFilter) return false;
      return true;
    });
  })();

  // True when any filter chrome is constraining the list. Used by the
  // workspace-empty zero-state collapse so we don't hide the filter
  // controls behind a CTA when a filter is the actual reason the list
  // is empty.
  const filtersActive =
    idQuery.trim() !== "" ||
    agentFilterUrl !== ALL_AGENTS ||
    runtimeFilter !== ALL_RUNTIMES ||
    timeFilter !== DEFAULT_TIME_PRESET;

  if (currentWorkspaceId === null) {
    return (
      <div className="alert alert--error">
        No workspace is selected. Use the workspace dropdown in the top bar to choose or create one
        — sessions are scoped to a workspace.
      </div>
    );
  }

  // The workdir hint shows the user-facing display name (not the UUID),
  // falling back to the id only if metadata hasn't loaded yet.
  const currentDisplayName =
    workspaces.find((w) => w.id === currentWorkspaceId)?.name ?? currentWorkspaceId;

  return (
    <>
      <HeaderActions>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreateOpen(true)}
          disabled={createAgents.length === 0}
          title={
            createAgents.length === 0
              ? "Install at least one ready agent in the Catalog first"
              : "Create a new session"
          }
        >
          <PlusIcon />
          <span>New session</span>
        </button>
      </HeaderActions>

      <div className="sessions-page">
        <div className="page-toolbar">
          <div
            className="page-toolbar__actions"
            style={{ gap: "var(--space-3)", alignItems: "center" }}
          >
            <label htmlFor="session-id-filter" className="muted" style={{ fontSize: 12 }}>
              Search
            </label>
            <input
              id="session-id-filter"
              type="search"
              value={idQuery}
              onChange={(e) => setIdQuery(e.target.value)}
              placeholder="session id…"
              className="input"
              style={{ width: 160 }}
            />
            <label htmlFor="agent-filter" className="muted" style={{ fontSize: 12 }}>
              Agent
            </label>
            <select
              id="agent-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="select"
            >
              <option value={ALL_AGENTS}>All</option>
              {agents.map((a) => (
                <option key={a.agent.fqn} value={a.agent.fqn}>
                  {a.agent.fqn}
                </option>
              ))}
            </select>
            <label htmlFor="runtime-filter" className="muted" style={{ fontSize: 12 }}>
              Runtime
            </label>
            <select
              id="runtime-filter"
              value={runtimeFilter}
              onChange={(e) => setRuntimeFilter(e.target.value)}
              className="select"
              disabled={runtimes.length === 0}
            >
              <option value={ALL_RUNTIMES}>All</option>
              {runtimes.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Active
            </span>
            <div className="pills">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`pills__btn${timeFilter === p.value ? " pills__btn--active" : ""}`}
                  onClick={() => setTimeFilter(p.value)}
                  aria-pressed={timeFilter === p.value}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="alert alert--error">⚠️ {error}</div>}

        <div className="sessions-page__body">
          {!loaded ? (
            <div className="empty">
              <div className="empty__icon spin" aria-hidden="true">
                <RefreshIcon />
              </div>
              <p className="empty__title">Loading sessions…</p>
            </div>
          ) : visibleSessions.length === 0 ? (
            // Sessions is a single-column list page, so the empty / no-match
            // states render in place of the list (there is no detail pane to
            // fill). Show the rich "No sessions yet" zero-state with its CTA
            // only when the workspace is genuinely empty AND no filter is
            // constraining the list; when a filter is active, keep the
            // standard filter-empty copy so the user sees what's hiding the
            // rows. Either way `.sessions-page__body` centers the card in the
            // remaining height instead of letting it float at the top.
            sessions.length === 0 && !filtersActive ? (
              <div className="empty tasks-pane__zero" data-testid="sessions-empty-zero">
                <div className="empty__icon" aria-hidden="true">
                  📂
                </div>
                <p className="empty__title">No sessions yet</p>
                <p className="empty__hint">
                  Create a session to bake an agent into a workdir, then launch <code>copilot</code>{" "}
                  there.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCreateOpen(true)}
                  disabled={createAgents.length === 0}
                  title={
                    createAgents.length === 0
                      ? "Install at least one ready agent in the Catalog first"
                      : "Create a new session"
                  }
                  data-testid="sessions-empty-zero-cta"
                >
                  <PlusIcon />
                  <span>New session</span>
                </button>
              </div>
            ) : (
              <div className="empty">
                <div className="empty__icon">📂</div>
                <p className="empty__title">No matches</p>
                <p className="empty__hint">Adjust the filters above to see more sessions.</p>
              </div>
            )
          ) : (
            <ul className="session-list" aria-label="Sessions">
              {visibleSessions.map((s) => (
                <SessionListItem
                  key={s.id}
                  session={s}
                  launching={launchingId === s.id}
                  preselected={preselectedSessionId === s.id}
                  onPreselectConsumed={() => setPreselectedSessionId(null)}
                  onLaunch={(opts) => onLaunch(s, opts)}
                  onDelete={() => setDeleteModal({ session: s, purge: false })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <CreateModal
        open={createOpen}
        agents={createAgents}
        runtimes={runtimes}
        workspaceDisplayName={currentDisplayName}
        pathSeparator={config?.pathSeparator ?? "/"}
        busy={busy}
        // When `?agent=<fqn>` is active, seed the modal with that agent.
        // "All" keeps the `agents[0]` fallback.
        initialAgent={agentFilterUrl !== ALL_AGENTS ? agentFilterUrl : undefined}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreated}
      />

      {fallback && (
        <Modal
          open={true}
          onClose={() => setFallback(null)}
          title="Couldn't open a terminal"
          size="default"
        >
          <FallbackModalBody
            display={fallback.display}
            reason={fallback.reason}
            onClose={() => setFallback(null)}
          />
        </Modal>
      )}

      {deleteModal && (
        <Modal
          open={true}
          onClose={() => setDeleteModal(null)}
          title="Delete session"
          size="default"
        >
          <DeleteModalBody
            session={deleteModal.session}
            purge={deleteModal.purge}
            busy={busy}
            onToggle={(v) => setDeleteModal((prev) => (prev ? { ...prev, purge: v } : prev))}
            onCancel={() => setDeleteModal(null)}
            onConfirm={onConfirmDelete}
          />
        </Modal>
      )}
    </>
  );
}
