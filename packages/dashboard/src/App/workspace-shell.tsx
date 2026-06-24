import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  type CatalogData,
  fetchAll,
  getConfig,
  listWorkspaces,
  type ServerConfig,
  setActiveWorkspace,
  setServerCurrentWorkspace,
  updateWorkspaceMetadata,
  type WorkspaceListItem,
} from "../api";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { HeaderActionsContext } from "../components/HeaderActions";
import {
  type RuntimeChildId,
  type SectionDef,
  type SectionId,
  Sidebar,
  type SidebarItemId,
} from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import {
  BreadcrumbContext,
  type BreadcrumbValue,
  WorkspaceShellContext,
} from "../components/WorkspaceShellContext";
import { startClockSync } from "../server-clock";
import { AddWorkspaceModal } from "./workspace-modals";

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

/**
 * Map a URL pathname back to the sidebar item identifier. The first
 * path segment after `/workspaces/<workspaceId>/` selects the top-level
 * section; for `runtime`, the **second** segment selects which Runtime
 * child is highlighted (Agents / Sessions / Tasks / Schedules / Workflows). Unknown segments
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
export function WorkspaceShell() {
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
                <ErrorBoundary label="page content">
                  <Outlet />
                </ErrorBoundary>
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

function buildSectionPath(workspaceId: string, section: SectionId): string {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}/${section}`;
  if (section === "catalog") return `${base}/agents`;
  if (section === "runtime") return `${base}/agents`;
  return base;
}
