import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  addWorkspace,
  type CatalogData,
  fetchAll,
  getConfig,
  getServerCurrentWorkspace,
  listWorkspaces,
  removeWorkspace,
  type ServerConfig,
  setActiveWorkspace,
  setServerCurrentWorkspace,
  updateWorkspaceMetadata,
  type WorkspaceListItem,
} from "./api";
import { HeaderActionsContext } from "./components/HeaderActions";
import { PlusIcon, TrashIcon } from "./components/Icons";
import { Modal } from "./components/Modal";
import {
  type RuntimeChildId,
  type SectionDef,
  type SectionId,
  Sidebar,
  type SidebarItemId,
} from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import {
  BreadcrumbContext,
  type BreadcrumbValue,
  useBreadcrumb,
  useWorkspaceShell,
  WorkspaceShellContext,
} from "./components/WorkspaceShellContext";
import { CatalogPage, type CatalogTab } from "./pages/Catalog";
import { OverviewPage } from "./pages/Overview";
import { AgentsListPage } from "./pages/Runtime/AgentsListPage";
import { SchedulesPage } from "./pages/Schedules";
import { SessionsPage } from "./pages/Sessions";
import { SettingsPage } from "./pages/Settings";
import { TasksPage } from "./pages/Tasks";
import { WorkflowsPage } from "./pages/Workflows";
import { startClockSync } from "./server-clock";
import { formatRelative } from "./utils/time";

const SECTIONS: SectionDef[] = [
  { id: "overview", label: "Overview" },
  {
    id: "runtime",
    label: "Runtime",
    children: [
      { id: "agents", label: "Agents" },
      { id: "sessions", label: "Sessions" },
      { id: "tasks", label: "Tasks" },
      { id: "workflows", label: "Workflows" },
      { id: "schedules", label: "Schedules" },
    ],
  },
  { id: "catalog", label: "Catalog" },
  { id: "settings", label: "Settings" },
];

const SECTION_TITLES: Record<SectionId, { title: string; crumb?: string }> = {
  overview: { title: "Overview", crumb: "System health" },
  runtime: { title: "Runtime", crumb: "Agents" },
  catalog: { title: "Catalog", crumb: "Agents · Skills · MCPs" },
  settings: { title: "Settings", crumb: "Server & environment" },
};

const VALID_SECTIONS = new Set<SectionId>(["overview", "runtime", "catalog", "settings"]);
const VALID_RUNTIME_CHILDREN = new Set<RuntimeChildId>([
  "agents",
  "sessions",
  "tasks",
  "schedules",
  "workflows",
]);
const VALID_CATALOG_TABS = new Set<CatalogTab>(["agents", "skills", "mcps"]);

/**
 * Router host. Owns no state itself  every page's identity (workspace,
 * section, catalog tab) is encoded in the URL. Two browser tabs at
 * different URLs stay independent because there's no shared global state.
 *
 * The workspace identifier in the URL is the registry's UUID `workspaceId`; the
 * user-facing display name lives in `metadata.name` and may change at any
 * time without breaking links.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/workspaces/:workspaceId" element={<WorkspaceShell />}>
        <Route index element={<WorkspaceIndexRedirect />} />
        <Route path="overview" element={<OverviewRoute />} />
        <Route path="catalog" element={<CatalogIndexRedirect />} />
        <Route path="catalog/:tab" element={<CatalogRoute />} />
        <Route path="settings" element={<SettingsRoute />} />
        <Route path="runtime" element={<RuntimeIndexRedirect />} />
        <Route path="runtime/agents" element={<AgentsListPage />} />
        <Route path="runtime/sessions" element={<RuntimeSessionsRoute />} />
        <Route path="runtime/tasks" element={<RuntimeTasksRoute />} />
        <Route path="runtime/schedules" element={<RuntimeSchedulesRoute />} />
        <Route path="runtime/workflows" element={<RuntimeWorkflowsRoute />} />
        <Route path="*" element={<NotFoundRedirect />} />
      </Route>
      <Route path="*" element={<NotFoundRedirect />} />
    </Routes>
  );
}

/**
 * Hub landing page. Lists every registered workspace as a clickable card
 * (showing the user-chosen display name, not the UUID), plus an
 * "Add workspace" CTA. Acts as both the entry point (`/`) and the fallback
 * for any unknown URL  `*` redirects here. The server's last-opened
 * workspace is highlighted but never auto-navigated; the user always
 * picks. Keeps multi-tab usage predictable.
 */
function LandingPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[] | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [list, sc] = await Promise.all([
        listWorkspaces(),
        getServerCurrentWorkspace().catch(() => ({ id: null as string | null })),
      ]);
      setWorkspaces(list);
      setRecent(sc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkspaces([]);
    }
  }, []);

  // Clear the active-workspace slot whenever the landing page is shown so
  // any background API call from a stale layout doesn't leak across.
  useLayoutEffect(() => {
    setActiveWorkspace(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enterWorkspace = useCallback(
    (id: string) => {
      navigate(`/workspaces/${encodeURIComponent(id)}/overview`);
    },
    [navigate],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceListItem | null>(null);

  // Sort: recent first, then ok before broken, then by display name.
  const ordered = (workspaces ?? []).slice().sort((a, b) => {
    if (a.id === recent && b.id !== recent) return -1;
    if (b.id === recent && a.id !== recent) return 1;
    const aDisplay = a.name ?? a.id;
    const bDisplay = b.name ?? b.id;
    return aDisplay.localeCompare(bDisplay);
  });

  return (
    <div className="landing">
      <div className="landing__container">
        <header className="landing__hero">
          <div className="landing__logo" aria-hidden="true">
            E
          </div>
          <h1 className="landing__brand">glyph</h1>
          <p className="landing__tagline">Per-workspace agent orchestration</p>
        </header>

        {error && <div className="alert alert--error"> {error}</div>}

        <section className="landing__section">
          <div className="landing__section-header">
            <h2 className="landing__section-title">
              Workspaces
              {workspaces !== null && (
                <span className="landing__section-count">{workspaces.length}</span>
              )}
            </h2>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setError(null);
                setAddOpen(true);
              }}
            >
              <PlusIcon /> Add workspace
            </button>
          </div>

          {workspaces === null ? (
            <p className="muted">Loading</p>
          ) : workspaces.length === 0 ? (
            <div className="landing__empty">
              <p className="landing__empty-title">No workspaces registered yet</p>
              <p className="muted">
                A workspace is the project root that holds glyph's per-project sessions, catalog,
                tasks and workflows. Add one to get started.
              </p>
            </div>
          ) : (
            <div className="landing__grid">
              {ordered.map((ws) => {
                const display = ws.name ?? ws.id;
                const isRecent = ws.id === recent;
                const enter = () => {
                  enterWorkspace(ws.id);
                };
                return (
                  // biome-ignore lint/a11y/useSemanticElements: card has nested Remove <button>; nesting buttons is invalid HTML
                  <div
                    key={ws.id}
                    className="landing__card"
                    role="button"
                    tabIndex={0}
                    onClick={enter}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        enter();
                      }
                    }}
                    title={`Open ${display}`}
                  >
                    <div className="landing__card-row">
                      <span className="landing__card-name">{display}</span>
                      {isRecent && <span className="landing__card-badge">Recent</span>}
                    </div>
                    <div className="landing__card-path" title={ws.workspaceDir}>
                      {ws.workspaceDir}
                    </div>
                    <div className="landing__card-footer">
                      <span className="landing__card-meta">
                        {`Created ${formatRelative(ws.createdAt)}`}
                      </span>
                      <button
                        type="button"
                        className="landing__card-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          setError(null);
                          setRemoveTarget(ws);
                        }}
                        aria-label={`Remove ${display}`}
                        title={`Remove "${display}" from registry`}
                      >
                        <TrashIcon />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <AddWorkspaceModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          setAddOpen(false);
          enterWorkspace(id);
        }}
      />

      <RemoveWorkspaceModal
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={async () => {
          setRemoveTarget(null);
          await refresh();
        }}
      />
    </div>
  );
}

interface AddWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

/**
 * Two-field form: display name (required) + workspace directory
 * (optional). Used in place of two sequential window.prompt() dialogs
 * which gave no chance to revise inputs and looked out of place compared
 * to the rest of the dashboard. When the directory is omitted, the
 * server allocates one under `$GLYPH_HOME/workspaces/<uuid>/` and
 * uses the same UUID as the workspace's registry id, so id and on-disk
 * dir name stay in sync.
 */
function AddWorkspaceModal({ open, onClose, onCreated }: AddWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens so a previous failed attempt
  // doesn't leak its values into the next session.
  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (trimmedName === "") {
      setError("Display name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await addWorkspace({
        name: trimmedName,
        ...(trimmedPath !== "" ? { workspaceDir: trimmedPath } : {}),
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add workspace">
      <form onSubmit={onSubmit}>
        <div className="modal__body">
          <div className="form-field">
            <label htmlFor="add-ws-name">Display name</label>
            <input
              id="add-ws-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme prod"
              // biome-ignore lint/a11y/noAutofocus: opens in response to a user click; auto-focusing the first field is expected UX
              autoFocus
              disabled={busy}
              required
            />
            <p className="form-hint">Free-form text shown in the sidebar and on this page.</p>
          </div>

          <div className="form-field">
            <label htmlFor="add-ws-path">
              Workspace directory <span className="form-label-aside">(optional)</span>
            </label>
            <input
              id="add-ws-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="leave blank for default"
              disabled={busy}
            />
            <p className="form-hint">
              Absolute path on the <strong>server's</strong> filesystem. Leave blank to let glyph
              create one under <code>$GLYPH_HOME/workspaces/&lt;uuid&gt;/</code>.
            </p>
          </div>

          {error && <div className="alert alert--error">⚠ {error}</div>}
        </div>
        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || name.trim() === ""}>
            {busy ? "Adding…" : "Add workspace"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface RemoveWorkspaceModalProps {
  target: WorkspaceListItem | null;
  onClose: () => void;
  onRemoved: () => void | Promise<void>;
}

/**
 * Confirmation dialog for DELETE /api/workspaces/:id. The destructive
 * action is intentionally a danger-style button so it stands out, but
 * the message also makes clear that the on-disk workspace files are
 * preserved — only the registry entry goes away.
 */
function RemoveWorkspaceModal({ target, onClose, onRemoved }: RemoveWorkspaceModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setBusy(false);
      setError(null);
    }
  }, [target]);

  if (!target) return null;
  const display = target.name ?? target.id;

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeWorkspace(target.id);
      await onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Remove workspace">
      <div className="modal__body">
        <p>
          Remove <code>{display}</code> from glyph?
        </p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Path: <code>{target.workspaceDir}</code>
        </p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          The workspace files on disk are kept untouched. Only glyph's metadata (the registry entry
          in <code>global.db</code>) is removed. You can re-add this path later.
        </p>
        {error && <div className="alert alert--error">⚠ {error}</div>}
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </Modal>
  );
}

/** `/workspaces/<uuid>` -> `/workspaces/<uuid>/overview`. */
function WorkspaceIndexRedirect() {
  return <Navigate to="overview" replace />;
}

/** `/workspaces/<uuid>/catalog` -> `/workspaces/<uuid>/catalog/agents`. */
function CatalogIndexRedirect() {
  return <Navigate to="agents" replace />;
}

/** `/workspaces/<uuid>/runtime` -> `/workspaces/<uuid>/runtime/agents`. */
function RuntimeIndexRedirect() {
  return <Navigate to="agents" replace />;
}

function NotFoundRedirect() {
  return <Navigate to="/" replace />;
}

/**
 * Map a URL pathname back to the sidebar item identifier. The first
 * path segment after `/workspaces/<workspaceId>/` selects the top-level
 * section; for `runtime`, the **second** segment selects which Runtime
 * child is highlighted (Agents / Sessions / Tasks). Unknown segments
 * fall back to `overview` so the sidebar always has a highlighted row.
 *
 * The compound `runtime:<child>` return value (a single string) keeps
 * the sidebar invariant out of `App.tsx` — the renderer reads both
 * halves from one id.
 */
function sectionFromPathname(pathname: string, workspaceId: string): SidebarItemId {
  const prefix = `/workspaces/${encodeURIComponent(workspaceId)}/`;
  if (!pathname.startsWith(prefix)) return "overview";
  const rest = pathname.slice(prefix.length);
  const segments = rest.split("/");
  const first = segments[0] ?? "";
  if (first === "runtime") {
    const child = segments[1] ?? "agents";
    return VALID_RUNTIME_CHILDREN.has(child as RuntimeChildId)
      ? (`runtime:${child as RuntimeChildId}` as SidebarItemId)
      : "runtime";
  }
  return VALID_SECTIONS.has(first as SectionId) ? (first as SectionId) : "overview";
}

/**
 * The workspace-scoped shell. Owns Sidebar / TopBar / content layout;
 * pulls workspace id from the URL via useParams, syncs it into the api
 * module's active-workspace slot, fetches the workspace registry +
 * catalog data once, and exposes everything to child routes via
 * `WorkspaceShellContext` so they don't have to thread props.
 *
 * The shell renders an `<Outlet />` for child routes (overview /
 * catalog / settings / runtime/*) so each page owns its route-local
 * state while sharing the same workspace chrome.
 */
function WorkspaceShell() {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceId = params.workspaceId ?? "";

  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[] | null>(null);
  const [data, setData] = useState<CatalogData>({
    overview: null,
    skills: [],
    agents: [],
    mcps: [],
  });
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [headerActionsHost, setHeaderActionsHost] = useState<HTMLDivElement | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbValue | null>(null);

  // Sync the URL's workspaceId into the api module's active-workspace slot
  // BEFORE any child effect fires (useLayoutEffect runs before useEffect),
  // so the catalog/sessions fetches that follow read the right workspace.
  useLayoutEffect(() => {
    setActiveWorkspace(workspaceId || null);
    return () => setActiveWorkspace(null);
  }, [workspaceId]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorkspaces([]);
    }
  }, []);

  const refreshData = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchAll();
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void refreshWorkspaces();
    void refreshData();
    setServerCurrentWorkspace(workspaceId).catch(() => {
      // ignore: the URL is already authoritative for this tab
    });
  }, [workspaceId, refreshWorkspaces, refreshData]);

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        // Non-fatal: pages that need config will render placeholders.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => startClockSync(), []);

  const sidebarItem: SidebarItemId = sectionFromPathname(location.pathname, workspaceId);
  // Top-level section the active sidebar item belongs to. For Runtime
  // children (`runtime:<child>`) this collapses back to `runtime` so
  // breadcrumb defaults and section-level navigation keep working.
  const section: SectionId =
    typeof sidebarItem === "string" && sidebarItem.startsWith("runtime:")
      ? "runtime"
      : (sidebarItem as SectionId);

  const navigateToSection = useCallback(
    (next: SectionId) => {
      navigate(buildSectionPath(workspaceId, next));
    },
    [navigate, workspaceId],
  );

  const navigateToRuntimeChild = useCallback(
    (child: RuntimeChildId) => {
      navigate(`/workspaces/${encodeURIComponent(workspaceId)}/runtime/${child}`);
    },
    [navigate, workspaceId],
  );

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      // Preserve the active section when switching workspaces.
      navigate(buildSectionPath(id, section));
    },
    [navigate, section],
  );

  const handleAddWorkspace = useCallback(() => {
    setError(null);
    setAddOpen(true);
  }, []);

  const handleRenameWorkspace = useCallback(
    async (id: string, newDisplayName: string) => {
      await updateWorkspaceMetadata(id, { name: newDisplayName });
      await refreshWorkspaces();
    },
    [refreshWorkspaces],
  );

  // Defaults derived from the URL section. Pages can override via
  // `useBreadcrumb(...)` (Runtime pages do); other pages stick with
  // the section defaults from `SECTION_TITLES`.
  const defaultBreadcrumb = useMemo<BreadcrumbValue>(() => {
    const meta = SECTION_TITLES[section];
    return {
      title: meta.title,
      chain: meta.crumb ? [meta.crumb] : [meta.title],
    };
  }, [section]);
  const effective = breadcrumb ?? defaultBreadcrumb;

  const breadcrumbContextValue = useMemo(() => ({ set: setBreadcrumb }), []);
  const shellContextValue = useMemo(
    () => ({ workspaceId, workspaces, data, config, refreshData }),
    [workspaceId, workspaces, data, config, refreshData],
  );

  // URL validation guards (after all hooks; avoid hooks-count drift).
  if (workspaces !== null && workspaceId && !workspaces.some((w) => w.id === workspaceId)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="shell">
      <Sidebar
        sections={SECTIONS}
        active={sidebarItem}
        onSelect={navigateToSection}
        onSelectRuntimeChild={navigateToRuntimeChild}
        workspaces={workspaces ?? []}
        currentWorkspaceId={workspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onAddWorkspace={handleAddWorkspace}
        onRenameWorkspace={handleRenameWorkspace}
      />

      <div className="main">
        <TopBar
          title={effective.title}
          breadcrumb={effective.chain}
          actionsRef={setHeaderActionsHost}
        />

        <HeaderActionsContext.Provider value={headerActionsHost}>
          <WorkspaceShellContext.Provider value={shellContextValue}>
            <BreadcrumbContext.Provider value={breadcrumbContextValue}>
              <div className="content">
                {error && <div className="alert alert--error">{error}</div>}
                <Outlet />
              </div>
            </BreadcrumbContext.Provider>
          </WorkspaceShellContext.Provider>
        </HeaderActionsContext.Provider>
      </div>

      <AddWorkspaceModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async (id) => {
          setAddOpen(false);
          await refreshWorkspaces();
          navigate(buildSectionPath(id, section));
        }}
      />
    </div>
  );
}

// Per-route adapters. Each pulls workspace shell data from context and
// reads its own URL params. Kept inline here because they're tiny and
// the routing wiring lives here too.

function OverviewRoute() {
  const { data } = useWorkspaceShell();
  return <OverviewPage overview={data.overview} />;
}

function CatalogRoute() {
  const navigate = useNavigate();
  const params = useParams<{ tab?: string }>();
  const { workspaceId, data, refreshData } = useWorkspaceShell();
  const tabIsValid = VALID_CATALOG_TABS.has(params.tab as CatalogTab);
  const tab: CatalogTab = (tabIsValid ? params.tab : "agents") as CatalogTab;
  useBreadcrumb(`Catalog / ${capitalize(tab)}`, ["Agents \u00b7 Skills \u00b7 MCPs"]);
  if (params.tab !== undefined && !tabIsValid) {
    return <Navigate to="/" replace />;
  }
  return (
    <CatalogPage
      tab={tab}
      onTabChange={(next) =>
        navigate(`/workspaces/${encodeURIComponent(workspaceId)}/catalog/${next}`)
      }
      skills={data.skills}
      agents={data.agents}
      mcps={data.mcps}
      currentWorkspaceId={workspaceId}
      onChanged={refreshData}
    />
  );
}

function SettingsRoute() {
  const { workspaceId, workspaces, config } = useWorkspaceShell();
  return (
    <SettingsPage
      serverUrl={typeof window !== "undefined" ? window.location.origin : ""}
      config={config}
      currentWorkspaceId={workspaceId}
      workspaces={workspaces ?? []}
    />
  );
}

/**
 * Workspace-scoped Sessions page. Reads `?agent=`, `?runtime=`,
 * `?range=`, and `?q=` from the URL so links can pre-apply filters.
 */
function RuntimeSessionsRoute() {
  const { workspaceId, data, config, workspaces } = useWorkspaceShell();
  useBreadcrumb("Sessions", ["Runtime", "Sessions"]);
  return (
    <SessionsPage
      agents={data.agents}
      config={config}
      currentWorkspaceId={workspaceId}
      workspaces={workspaces ?? []}
    />
  );
}

/**
 * Workspace-scoped Tasks page. URL filters are `?q`, `?agent`,
 * `?runtime`, and `?range`; `?taskId=` controls the selected row.
 */
function RuntimeTasksRoute() {
  const { workspaceId, data, config } = useWorkspaceShell();
  useBreadcrumb("Tasks", ["Runtime", "Tasks"]);
  return <TasksPage agents={data.agents} currentWorkspaceId={workspaceId} config={config} />;
}

/**
 * Workspace-scoped Schedules page. Renders the master-detail Schedules
 * view at `/workspaces/<workspaceId>/runtime/schedules`. The detail panel
 * selection is URL-driven via `?scheduleId=`, mirroring the Tasks page's
 * `?taskId=` pattern so refresh / back-button / share-link all reproduce
 * the same view.
 */
function RuntimeSchedulesRoute() {
  const { workspaceId, data, config } = useWorkspaceShell();
  useBreadcrumb("Schedules", ["Runtime", "Schedules"]);
  return <SchedulesPage agents={data.agents} currentWorkspaceId={workspaceId} config={config} />;
}

/**
 * Workspace-scoped Workflows page. Renders the master-detail
 * Workflows view at `/workspaces/<workspaceId>/runtime/workflows`. The
 * detail panel selection is URL-driven via `?workflowId=`, mirroring
 * the Tasks / Schedules `?taskId=` / `?scheduleId=` patterns.
 */
function RuntimeWorkflowsRoute() {
  const { workspaceId, data, config } = useWorkspaceShell();
  useBreadcrumb("Workflows", ["Runtime", "Workflows"]);
  return <WorkflowsPage agents={data.agents} currentWorkspaceId={workspaceId} config={config} />;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildSectionPath(workspaceId: string, section: SectionId): string {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/${section}`;
  if (section === "catalog") return `${base}/agents`;
  if (section === "runtime") return `${base}/agents`;
  return base;
}
