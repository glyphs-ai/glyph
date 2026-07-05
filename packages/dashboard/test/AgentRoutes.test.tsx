import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData, ServerConfig, SessionView, TaskRecord } from "../src/api";
import type { AgentEntry } from "../src/api/catalog.js";
import {
  WorkspaceShellContext,
  type WorkspaceShellContextValue,
} from "../src/components/WorkspaceShellContext";
import { AgentsListPage } from "../src/pages/Runtime/AgentsListPage";

// Module-mock the API layer at the boundary the pages import from. Each
// test sets the per-test return values via the `mock*` helpers below so
// we don't hit real `fetch` and don't depend on a server.
vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listTasks: vi.fn(),
    listSessions: vi.fn(),
    listRuntimes: vi.fn(),
  };
});

// Re-import the mocked functions so the helpers below can set their
// behavior without each test repeating the boilerplate.
import * as api from "../src/api";

const mockListTasks = api.listTasks as unknown as ReturnType<typeof vi.fn>;
const mockListSessions = api.listSessions as unknown as ReturnType<typeof vi.fn>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
  } as unknown as AgentEntry;
}

function makeTask(
  agent: string,
  status: TaskRecord["status"],
  id = `task-${Math.random()}`,
): TaskRecord {
  return {
    id,
    agent,
    status,
    brief: `${status} task for ${agent}`,
    details: "",
    origin: "standalone",
    metadata: {},
    createdAt: "2026-05-23T00:00:00Z",
  } as unknown as TaskRecord;
}

function makeShellValue(agents: AgentEntry[]): WorkspaceShellContextValue {
  const data: CatalogData = {
    overview: null,
    skills: [],
    agents,
    mcps: [],
  } as unknown as CatalogData;
  return {
    workspaceId: "ws-1",
    workspaces: [],
    data,
    config: { pathSeparator: "/" } as unknown as ServerConfig,
    refreshData: async () => {},
  };
}

function renderWithShell(ui: React.ReactNode, agents: AgentEntry[], initialPath: string) {
  const value = makeShellValue(agents);
  return render(
    <WorkspaceShellContext.Provider value={value}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </WorkspaceShellContext.Provider>,
  );
}

function MasterDetailRoutes() {
  return (
    <Routes>
      <Route path="/workspaces/:workspaceId/runtime/agents" element={<AgentsListPage />} />
    </Routes>
  );
}

beforeEach(() => {
  mockListTasks.mockReset();
  mockListSessions.mockReset();
  mockListRuntimes.mockReset();
  mockListTasks.mockResolvedValue([]);
  mockListSessions.mockResolvedValue([] as SessionView[]);
  mockListRuntimes.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentsListPage runtime routing", () => {
  it("renders each agent with the computed status (running vs idle) in the left list", async () => {
    const agents = [makeAgent("official/engineer"), makeAgent("acme/qa")];
    mockListTasks.mockResolvedValueOnce([
      makeTask("official/engineer", "running"),
      makeTask("acme/qa", "succeeded"),
    ]);

    renderWithShell(<AgentsListPage />, agents, "/workspaces/ws-1/runtime/agents");

    // Scope the pill count to the left list so the auto-selected detail
    // pane's own status pill does not inflate the count.
    const list = await screen.findByRole("list", { name: /Installed agents/i });
    await waitFor(() => {
      const pills = list.querySelectorAll('[role="status"]');
      expect(pills.length).toBe(2);
    });
    const pills = list.querySelectorAll('[role="status"]');
    // Order matches the catalog order (dev first, qa second).
    expect(pills[0].textContent).toMatch(/Running/);
    expect(pills[1].textContent).toMatch(/Idle/);
  });
});

describe("Agent detail selection", () => {
  const agents = [makeAgent("official/engineer")];

  it("renders the Overview view when ?selected= points at an installed agent", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded", "t-seed")]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );
    await waitFor(() => {
      expect(screen.getByText(/Recent tasks/i)).toBeTruthy();
    });
  });

  it("shows the Running pill on the master-detail header when the agent has a running task", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "running")]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );
    await waitFor(() => {
      // Multiple status pills exist after — list row + detail
      // header. At least one says Running.
      expect(screen.getAllByRole("status").some((p) => /Running/.test(p.textContent ?? ""))).toBe(
        true,
      );
    });
  });

  it("shows the Idle pill on the master-detail header when the agent has no running tasks", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded")]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );
    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalled();
    });
    await waitFor(() => {
      // List row + detail header pills, both Idle.
      const pills = screen.getAllByRole("status");
      expect(pills.length).toBeGreaterThanOrEqual(1);
      expect(pills.every((p) => /Idle/.test(p.textContent ?? ""))).toBe(true);
    });
  });
});

describe("Overview row click → opens row on the global Tasks/Sessions page", () => {
  const agents = [makeAgent("official/engineer")];

  it("renders recent-task rows as <Link> elements pointing at the global Tasks page with ?agent=&taskId=", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "running", "t-r1")]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    await waitFor(() => {
      expect(screen.getAllByText(/running task for official\/engineer/).length).toBeGreaterThan(0);
    });
    const links = screen
      .getAllByRole("link")
      .filter(
        (el) =>
          el.getAttribute("href") ===
            "/workspaces/ws-1/runtime/tasks?agent=official/engineer&taskId=t-r1" &&
          el.className.includes("agent-overview__row"),
      );
    expect(links.length).toBe(1);
  });

  it("renders active-session rows as <Link> elements pointing at the global Sessions page with ?agent=", async () => {
    mockListTasks.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([
      {
        id: "sess-1",
        agent: "official/engineer",
        runtime: "copilot",
        runtimeSessionId: null,
        lastActiveAt: null,
        createdAt: "2026-05-23T00:00:00Z",
        workdir: "/tmp/w",
        lastLaunchMode: null,
      } as unknown as SessionView,
    ]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    await waitFor(() => {
      expect(screen.getByText("sess-1")).toBeTruthy();
    });
    const links = screen
      .getAllByRole("link")
      .filter(
        (el) =>
          el.getAttribute("href") === "/workspaces/ws-1/runtime/sessions?agent=official/engineer" &&
          el.className.includes("agent-overview__row"),
      );
    expect(links.length).toBe(1);
  });

  it("clicking a recent-task row does not throw and the row stays mounted", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "running", "t-r1")]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    await waitFor(() => {
      expect(screen.getAllByText(/running task for official\/engineer/).length).toBeGreaterThan(0);
    });
    const link = screen
      .getAllByRole("link")
      .find(
        (el) =>
          el.getAttribute("href") ===
            "/workspaces/ws-1/runtime/tasks?agent=official/engineer&taskId=t-r1" &&
          el.className.includes("agent-overview__row"),
      );
    expect(link).toBeTruthy();
    link?.click();
    expect(link).toBeTruthy();
  });
});

describe("AgentOverviewTab 'View all' links", () => {
  const agents = [makeAgent("official/engineer")];

  it("renders a 'View all tasks' link pointing at the global Tasks page with ?agent=", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded", "t-1")]);
    mockListSessions.mockResolvedValue([
      {
        id: "sess-1",
        agent: "official/engineer",
        runtime: "copilot",
        runtimeSessionId: null,
        lastActiveAt: null,
        createdAt: "2026-05-23T00:00:00Z",
        workdir: "/tmp/w",
        lastLaunchMode: null,
      } as unknown as SessionView,
    ]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    await waitFor(() => {
      expect(screen.getByText(/View all tasks/i)).toBeTruthy();
    });
    const link = screen.getByText(/View all tasks/i).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      "/workspaces/ws-1/runtime/tasks?agent=official/engineer",
    );
    expect(link?.className).toContain("agent-overview__more");
  });

  it("renders a 'View all sessions' link pointing at the global Sessions page with ?agent=", async () => {
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded", "t-1")]);
    mockListSessions.mockResolvedValue([
      {
        id: "sess-1",
        agent: "official/engineer",
        runtime: "copilot",
        runtimeSessionId: null,
        lastActiveAt: null,
        createdAt: "2026-05-23T00:00:00Z",
        workdir: "/tmp/w",
        lastLaunchMode: null,
      } as unknown as SessionView,
    ]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    await waitFor(() => {
      expect(screen.getByText(/View all sessions/i)).toBeTruthy();
    });
    const link = screen.getByText(/View all sessions/i).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      "/workspaces/ws-1/runtime/sessions?agent=official/engineer",
    );
    expect(link?.className).toContain("agent-overview__more");
  });
});

describe("Empty states", () => {
  it("AgentsListPage renders 'No agents installed' panel when the catalog is empty", async () => {
    renderWithShell(<AgentsListPage />, [], "/workspaces/ws-1/runtime/agents");
    await waitFor(() => {
      expect(screen.getByText(/No agents installed/i)).toBeTruthy();
    });
    // And the empty-state hint links to /catalog/agents.
    const catalogLink = screen.getByRole("link", { name: /Catalog/i });
    expect(catalogLink.getAttribute("href")).toBe("/workspaces/ws-1/catalog/agents");
  });

  it("AgentOverviewTab renders the 'No activity yet' empty panel without an embedded Dispatch link", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([]);
    renderWithShell(
      <MasterDetailRoutes />,
      agents,
      "/workspaces/ws-1/runtime/agents?selected=official/engineer",
    );

    const empty = await screen.findByTestId("agent-overview-empty");
    expect(empty).toBeTruthy();
    expect(screen.getByText(/No activity yet/i)).toBeTruthy();
    // The inline "Dispatch a task ->" link inside the empty hint
    // duplicated the persistent "+ New task" button in the
    // AgentDetailPane header above the tab. The header button is now
    // the sole CTA for this case; the hint must NOT embed a Dispatch
    // link of its own.
    expect(within(empty).queryByText(/Dispatch a task/i)).toBeNull();
    // The 2x2 grid headings (Recent tasks / Active sessions) must NOT
    // render — the empty panel replaces them.
    expect(screen.queryByText(/Recent tasks/i)).toBeNull();
  });
});

describe("Live polling", () => {
  const agents = [makeAgent("official/engineer")];

  it("AgentDetailPane header pill refreshes when the workspace-wide polled fetch returns a new status", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // First fetch (initial mount): one running task.
      mockListTasks.mockResolvedValueOnce([makeTask("official/engineer", "running", "t-1")]);
      // Subsequent polled fetch(es): the task has completed; pill should
      // flip to Idle for the auto-selected agent.
      mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded", "t-1")]);

      renderWithShell(
        <MasterDetailRoutes />,
        agents,
        "/workspaces/ws-1/runtime/agents?selected=official/engineer",
      );

      await waitFor(() => {
        // At least one pill (list row + detail header) shows Running.
        expect(screen.getAllByRole("status").some((p) => /Running/.test(p.textContent ?? ""))).toBe(
          true,
        );
      });

      // Advance past the default 4 s poll interval so the
      // workspace-wide listTasks poll can refresh the status.
      await vi.advanceTimersByTimeAsync(4_500);

      await waitFor(() => {
        const pills = screen.getAllByRole("status");
        expect(pills.length).toBeGreaterThanOrEqual(1);
        expect(pills.every((p) => /Idle/.test(p.textContent ?? ""))).toBe(true);
      });
      expect(mockListTasks.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
