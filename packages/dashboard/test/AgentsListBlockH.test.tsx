import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData, ServerConfig, TaskRecord } from "../src/api";
import type { AgentEntry } from "../src/api/catalog.js";
import {
  WorkspaceShellContext,
  type WorkspaceShellContextValue,
} from "../src/components/WorkspaceShellContext";
import { AgentsListPage } from "../src/pages/Runtime/AgentsListPage";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listTasks: vi.fn(),
  };
});

import * as api from "../src/api";

const mockListTasks = api.listTasks as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
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
    brief: "",
    details: "",
    origin: "standalone",
    metadata: {},
    createdAt: "2026-05-23T00:00:00Z",
  } as unknown as TaskRecord;
}

function shell(agents: AgentEntry[]): WorkspaceShellContextValue {
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

function renderList(initialPath: string, agents: AgentEntry[]) {
  return render(
    <WorkspaceShellContext.Provider value={shell(agents)}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/workspaces/:workspaceId/runtime/agents" element={<AgentsListPage />} />
        </Routes>
      </MemoryRouter>
    </WorkspaceShellContext.Provider>,
  );
}

beforeEach(() => {
  mockListTasks.mockReset();
  mockListTasks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentsListPage filter and list behavior", () => {
  it("filter menu hides agents that don't match (?filter=active|idle)", async () => {
    const agents = [makeAgent("official/engineer"), makeAgent("acme/qa"), makeAgent("acme/docs")];
    // engineer has 1 running task; qa & docs have only completed tasks → idle.
    mockListTasks.mockResolvedValue([
      makeTask("official/engineer", "running", "t-r"),
      makeTask("acme/qa", "succeeded", "t-s1"),
      makeTask("acme/docs", "succeeded", "t-s2"),
    ]);

    renderList("/workspaces/ws-1/runtime/agents", agents);

    await waitFor(() => {
      // Three rows render initially under the "All" filter.
      expect(screen.getAllByText(/^engineer$/).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(/^engineer$/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^qa$/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^docs$/).length).toBeGreaterThan(0);

    // The pill bar was replaced by a popover. Open it first.
    fireEvent.click(screen.getByTestId("agents-filter-menu-trigger"));
    // Switch to Active — only engineer should remain.
    fireEvent.click(screen.getByTestId("agents-list-filter-active"));
    await waitFor(() => {
      expect(screen.queryAllByText(/^engineer$/).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/^qa$/).length).toBe(0);
      expect(screen.queryAllByText(/^docs$/).length).toBe(0);
    });

    // Switch to Idle — engineer disappears, qa+docs reappear.
    fireEvent.click(screen.getByTestId("agents-filter-menu-trigger"));
    fireEvent.click(screen.getByTestId("agents-list-filter-idle"));
    await waitFor(() => {
      expect(screen.queryAllByText(/^engineer$/).length).toBe(0);
      expect(screen.queryAllByText(/^qa$/).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/^docs$/).length).toBeGreaterThan(0);
    });
  });

  it("search filters rows by substring across short, scope, and fqn", async () => {
    const agents = [
      makeAgent("official/engineer"),
      makeAgent("official/qa"),
      makeAgent("third-party/docs-writer"),
    ];
    mockListTasks.mockResolvedValue([]);

    renderList("/workspaces/ws-1/runtime/agents?q=docs", agents);

    await waitFor(() => {
      // Match on the short-name suffix "docs-writer".
      expect(screen.queryAllByText(/^docs-writer$/).length).toBeGreaterThan(0);
      // No match for engineer or qa.
      expect(screen.queryAllByText(/^engineer$/).length).toBe(0);
      expect(screen.queryAllByText(/^qa$/).length).toBe(0);
    });

    // Match against scope this time.
    const input = screen.getByTestId("agents-list-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "official" } });
    await waitFor(() => {
      expect(screen.queryAllByText(/^engineer$/).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/^qa$/).length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/^docs-writer$/).length).toBe(0);
    });
  });

  it("row no longer renders the kebab menu (deleted in row redesign)", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    await waitFor(() => {
      // The row itself renders.
      expect(screen.getByTestId("agent-row-official/engineer")).toBeTruthy();
    });
    // The kebab and its menu items are gone — the row is a single
    // "click to select" target. Recent tasks / sessions live in the
    // detail pane on the right.
    expect(screen.queryByTestId("agent-row-menu")).toBeNull();
    expect(screen.queryByTestId("agent-row-menu-tasks")).toBeNull();
    expect(screen.queryByTestId("agent-row-menu-sessions")).toBeNull();
  });

  it("filter pill bar replaced by a popover (no inline fieldset, popover renders on demand)", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    await waitFor(() => {
      expect(screen.getByTestId("agents-filter-menu-trigger")).toBeTruthy();
    });
    // The old inline fieldset is gone.
    expect(screen.queryByTestId("agents-list-filter-tabs")).toBeNull();
    // Panel is closed by default (radio buttons not in the DOM yet).
    expect(screen.queryByTestId("agents-filter-menu-panel")).toBeNull();
    expect(screen.queryByTestId("agents-list-filter-all")).toBeNull();
    // Trigger reports closed via aria-expanded.
    expect(screen.getByTestId("agents-filter-menu-trigger").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("opening the filter popover reflects the current ?filter= value as the checked radio", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([]);
    renderList("/workspaces/ws-1/runtime/agents?filter=active", agents);

    await waitFor(() => {
      expect(screen.getByTestId("agents-filter-menu-trigger")).toBeTruthy();
    });
    // With ?filter=active the trigger surfaces the active label.
    expect(screen.getByTestId("agents-filter-menu-trigger").textContent).toMatch(/Active/);

    fireEvent.click(screen.getByTestId("agents-filter-menu-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("agents-filter-menu-panel")).toBeTruthy();
    });
    // The currently-active option is the only one with aria-checked=true.
    const activeOpt = screen.getByTestId("agents-list-filter-active");
    expect(activeOpt.getAttribute("aria-checked")).toBe("true");
    const allOpt = screen.getByTestId("agents-list-filter-all");
    expect(allOpt.getAttribute("aria-checked")).toBe("false");
  });
});

/**
 * Single-source row status (no triple-Idle).
 *
 * The old row layout emitted the word "Idle" in three slots per idle row
 * (subline `Idle  v`, the `AgentStatusPill`, and the activity-column
 * fallback). The current layout gives each slot one purpose:
 *
 *   - Subline: only `v{version}` (no status word).
 *   - Pill: the canonical status indicator (`Running` / `Idle`).
 *   - Activity: `N running` | `N task[s] · 7d` | (empty) | <skeleton>.
 *
 * `getAllByText("Idle")` inside an idle row must return length 1 — the
 * pill. The activity slot must NEVER render the literal string "Idle".
 */
describe("AgentRow single-source status (no triple-Idle)", () => {
  it("Loading: activity slot renders the skeleton until tasks resolve", () => {
    const agents = [makeAgent("official/engineer")];
    // listTasks pending forever — row stays in the loading branch.
    mockListTasks.mockReturnValue(new Promise<never>(() => {}));
    renderList("/workspaces/ws-1/runtime/agents", agents);

    expect(screen.getByTestId("agent-row-activity-skeleton-official/engineer")).toBeTruthy();
  });

  it("Idle + 7d > 0: activity reads `N tasks · 7d`, pill reads `Idle` exactly once", async () => {
    const agents = [makeAgent("official/engineer")];
    // 12 completed tasks in window, zero running → idle bucket with recent activity.
    mockListTasks.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => makeTask("official/engineer", "succeeded", `t-${i}`)),
    );
    renderList("/workspaces/ws-1/runtime/agents", agents);

    const row = await screen.findByTestId("agent-row-official/engineer");
    await waitFor(() => {
      const activity = within(row).getByTestId("agent-row-activity-official/engineer");
      expect(activity.textContent).toBe("12 tasks · 7d");
    });
    // Pill renders exactly once; no second / third "Idle" anywhere in the row.
    expect(within(row).getAllByText("Idle")).toHaveLength(1);
    const pill = within(row).getByRole("status");
    expect(pill.textContent).toMatch(/Idle/);
  });

  it("Idle + 7d == 0: activity slot has no visible text, pill reads `Idle` exactly once", async () => {
    const agents = [makeAgent("acme/research")];
    mockListTasks.mockResolvedValue([]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    const row = await screen.findByTestId("agent-row-acme/research");
    await waitFor(() => {
      expect(screen.queryByTestId("agent-row-activity-skeleton-acme/research")).toBeNull();
    });
    const activity = within(row).getByTestId("agent-row-activity-acme/research");
    // Activity slot collapses to empty — CSS min-height holds the row height,
    // but nothing visible is rendered (no literal "Idle", no "0 tasks").
    expect(activity.textContent ?? "").toBe("");
    expect(within(row).getAllByText("Idle")).toHaveLength(1);
  });

  it("Running: activity reads `N running`, pill reads `Running`", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([
      makeTask("official/engineer", "running", "t-r1"),
      makeTask("official/engineer", "running", "t-r2"),
      makeTask("official/engineer", "running", "t-r3"),
    ]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    const row = await screen.findByTestId("agent-row-official/engineer");
    await waitFor(() => {
      const activity = within(row).getByTestId("agent-row-activity-official/engineer");
      expect(activity.textContent).toBe("3 running");
    });
    const pill = within(row).getByRole("status");
    expect(pill.textContent).toMatch(/Running/);
    // The word "Idle" must NOT appear anywhere in a running row.
    expect(within(row).queryAllByText("Idle")).toHaveLength(0);
  });

  it("Singular vs plural: `1 task · 7d` (no `s`) when totalTasks7d === 1", async () => {
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([makeTask("official/engineer", "succeeded", "t-1")]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    const row = await screen.findByTestId("agent-row-official/engineer");
    await waitFor(() => {
      const activity = within(row).getByTestId("agent-row-activity-official/engineer");
      expect(activity.textContent).toBe("1 task · 7d");
    });
  });

  it("idle row renders the word 'Idle' exactly once", async () => {
    // Old subline emitted "Idle + version", pill emitted "Idle", and the
    // activity-column fallback emitted "Idle" → three occurrences per row.
    const agents = [makeAgent("official/engineer")];
    mockListTasks.mockResolvedValue([]);
    renderList("/workspaces/ws-1/runtime/agents", agents);

    const row = await screen.findByTestId("agent-row-official/engineer");
    await waitFor(() => {
      expect(screen.queryByTestId("agent-row-activity-skeleton-official/engineer")).toBeNull();
    });
    expect(within(row).getAllByText("Idle")).toHaveLength(1);
    // The stale subline emitted "Active" for the running case  that
    // tokens must not regress either.
    expect(within(row).queryAllByText("Active")).toHaveLength(0);
  });
});
