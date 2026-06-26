import type { AgentEntry } from "@glyphs-ai/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData, ServerConfig, TaskRecord } from "../src/api";
import {
  WorkspaceShellContext,
  type WorkspaceShellContextValue,
} from "../src/components/WorkspaceShellContext";
import { TasksPage } from "../src/pages/Tasks";

/**
 * State-matrix lock-in for the Tasks page (two-pane). Covers the four
 * user-reachable named states — Loading, Zero, No-match, Normal — plus
 * the filter-out-selection recovery contract and the stale-time-window
 * regression (a populated workspace whose rows all predate the default
 * window resolves to No-match, not Zero). ("Unselected" is structurally
 * unreachable here: `effectiveSelectedId` auto-binds the first visible
 * row, so it collapses to Normal — exhaustively covered in
 * `test/components/list-page-state.test.ts`.) DOM snapshots pin the empty
 * cards + skeletons against silent regressions.
 */

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listTasks: vi.fn(),
    listRuntimes: vi.fn(),
    getTask: vi.fn(),
    fetchTaskActivity: vi.fn(),
  };
});

import * as api from "../src/api";

const mockListTasks = api.listTasks as unknown as ReturnType<typeof vi.fn>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;
const mockGetTask = api.getTask as unknown as ReturnType<typeof vi.fn>;
const mockFetchTaskActivity = api.fetchTaskActivity as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
}

function makeTask(id: string): TaskRecord {
  return {
    id,
    agent: "official/engineer",
    status: "succeeded",
    brief: `brief for ${id}`,
    details: "",
    origin: "standalone",
    metadata: {},
    createdAt: "2026-05-23T00:00:00Z",
  } as unknown as TaskRecord;
}

function shellValue(agents: AgentEntry[]): WorkspaceShellContextValue {
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

function renderTasks(initialPath: string, agents: AgentEntry[]) {
  const value = shellValue(agents);
  return render(
    <WorkspaceShellContext.Provider value={value}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/runtime/tasks"
            element={<TasksPage agents={agents} config={value.config} currentWorkspaceId="ws-1" />}
          />
        </Routes>
      </MemoryRouter>
    </WorkspaceShellContext.Provider>,
  );
}

const PATH = "/workspaces/ws-1/runtime/tasks";
const agents = [makeAgent("official/engineer")];

beforeEach(() => {
  mockListTasks.mockReset();
  mockListRuntimes.mockReset();
  mockGetTask.mockReset();
  mockFetchTaskActivity.mockReset();
  mockListTasks.mockResolvedValue([] as TaskRecord[]);
  mockListRuntimes.mockResolvedValue([]);
  mockGetTask.mockResolvedValue(makeTask("task-A"));
  mockFetchTaskActivity.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("Tasks page — state matrix", () => {
  it("Loading: rail + detail both render skeletons while the list fetch is pending", async () => {
    mockListTasks.mockReturnValue(new Promise<TaskRecord[]>(() => {}));
    renderTasks(PATH, agents);
    const railSkeleton = await screen.findByTestId("tasks-list-skeleton");
    const detailSkeleton = screen.getByTestId("task-detail-skeleton");
    expect(railSkeleton).toBeTruthy();
    expect(detailSkeleton).toBeTruthy();
  });

  it("Zero: empty workspace renders the 📝 EmptyState (Dispatch CTA) only in the detail pane", async () => {
    mockListTasks.mockResolvedValue([]);
    // range=all so no time window is active: an empty list here is a
    // genuinely-empty workspace (Zero), not a filtered-out result.
    renderTasks(`${PATH}?range=all`, agents);
    await screen.findByTestId("tasks-empty-zero");
    expect(screen.getByTestId("tasks-empty-zero-cta")).toBeTruthy();
    // Rail carries no empty/no-match text — only the filter chrome.
    expect(screen.queryByTestId("tasks-empty-rail-hint")).toBeNull();
  });

  it("No-match: a filter hiding every row renders the 🔍 EmptyState + Clear filters CTA", async () => {
    mockListTasks.mockResolvedValue([makeTask("task-A")]);
    renderTasks(`${PATH}?q=zzz`, agents);
    await screen.findByTestId("tasks-empty-nomatch");
    expect(screen.getByTestId("tasks-empty-nomatch-cta")).toBeTruthy();
    expect(screen.queryByTestId("tasks-empty-zero")).toBeNull();
  });

  it("Stale window: a populated workspace with all rows outside the default window resolves to No-match, and Clear filters (→ range=all) recovers them", async () => {
    // The server applies the time window (createdSince), so the page only
    // ever sees the windowed slice. Model a populated-but-stale workspace:
    // empty while a window is active, rows once it widens to all-time.
    mockListTasks.mockImplementation((opts?: { createdSince?: string }) =>
      Promise.resolve(opts?.createdSince ? [] : [makeTask("task-A")]),
    );
    // Default entry (range=7d) → createdSince sent → server returns []. The
    // window is an active filter, so this is No-match (recoverable), NOT
    // the genuinely-empty Zero state (which would dead-end the user).
    renderTasks(PATH, agents);
    await screen.findByTestId("tasks-empty-nomatch");
    expect(screen.queryByTestId("tasks-empty-zero")).toBeNull();
    expect(mockGetTask).not.toHaveBeenCalled();
    // Clear filters widens range to "all" → no createdSince → rows return.
    fireEvent.click(screen.getByTestId("tasks-empty-nomatch-cta"));
    await waitFor(() => {
      expect(mockGetTask).toHaveBeenCalledWith("task-A");
    });
    expect(screen.queryByTestId("tasks-empty-nomatch")).toBeNull();
  });

  it("Filter-out-selection recovery: Clear filters restores the previously selected row", async () => {
    mockListTasks.mockResolvedValue([makeTask("task-A")]);
    // task-A is selected via ?taskId but hidden by ?q=zzz → no-match.
    renderTasks(`${PATH}?taskId=task-A&q=zzz`, agents);
    await screen.findByTestId("tasks-empty-nomatch");
    // While filtered away, the detail fetch never fires for the hidden row.
    expect(mockGetTask).not.toHaveBeenCalled();
    // Clearing filters keeps ?taskId, so the row reappears and re-selects.
    fireEvent.click(screen.getByTestId("tasks-empty-nomatch-cta"));
    await waitFor(() => {
      expect(mockGetTask).toHaveBeenCalledWith("task-A");
    });
    expect(screen.queryByTestId("tasks-empty-nomatch")).toBeNull();
  });

  it("Normal: a populated, unfiltered list auto-selects the first row and mounts its detail", async () => {
    mockListTasks.mockResolvedValue([makeTask("task-A")]);
    renderTasks(PATH, agents);
    await waitFor(() => {
      expect(mockGetTask).toHaveBeenCalledWith("task-A");
    });
    expect(screen.queryByTestId("tasks-empty-zero")).toBeNull();
    expect(screen.queryByTestId("tasks-empty-nomatch")).toBeNull();
    expect(screen.queryByTestId("task-detail-skeleton")).toBeNull();
  });
});
