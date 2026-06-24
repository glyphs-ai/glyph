import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { LandingPage } from "./App/landing";
import { WorkspaceShell } from "./App/workspace-shell";
import { useBreadcrumb, useWorkspaceShell } from "./components/WorkspaceShellContext";
import { CatalogPage, type CatalogTab } from "./pages/Catalog";
import { OverviewPage } from "./pages/Overview";
import { AgentsListPage } from "./pages/Runtime/AgentsListPage";
import { SchedulesPage } from "./pages/Schedules";
import { SessionsPage } from "./pages/Sessions";
import { SettingsPage } from "./pages/Settings";
import { TasksPage } from "./pages/Tasks";
import { WorkflowsPage } from "./pages/Workflows";

const VALID_CATALOG_TABS = new Set<CatalogTab>(["agents", "skills", "mcps"]);

/**
 * Router host. Owns no state itself  every page's identity (workspace,
 * section, catalog tab) is encoded in the URL. Two browser tabs at
 * different URLs stay independent because there's no shared global state.
 *
 * The workspace identifier in the URL is the registry's UUID `workspaceId`; the
 * user-facing display name lives in `name` and may change at any
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
