import type { AgentEntry } from "@glyphs-ai/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDag, WorkflowHeader } from "../src/api";

/**
 * State-matrix lock-in for the Workflows page (two-pane). Covers the four
 * user-reachable named states — Loading, Zero, No-match, Normal — plus the
 * contract that the detail pane is skeletonised during the INITIAL list
 * load (not just mid-flight), and a stale-time-window regression (a
 * populated workspace whose workflows all predate the default window
 * resolves to No-match, not Zero). "Unselected" is unreachable here
 * (auto-bind), so it collapses to Normal and is exercised by the
 * Normal-state cases below. Each reachable state is pinned by explicit
 * testid presence/absence + CTA assertions below; the brittle DOM
 * snapshots were dropped this round.
 */

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    getWorkflowDag: vi.fn(),
  };
});

import * as api from "../src/api";
import { HeaderActionsContext } from "../src/components/HeaderActions";
import { WorkflowsPage } from "../src/pages/Workflows";

const mockListWorkflows = api.listWorkflows as unknown as ReturnType<typeof vi.fn>;
const mockGetWorkflow = api.getWorkflow as unknown as ReturnType<typeof vi.fn>;
const mockGetWorkflowDag = api.getWorkflowDag as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
    coordEligible: true,
  } as unknown as AgentEntry;
}

function makeWorkflow(overrides: Partial<WorkflowHeader> = {}): WorkflowHeader {
  return {
    id: "wf-1",
    brief: "Default workflow",
    status: "running",
    origin: "standalone",
    coordinatorAgent: "official/engineer",
    metadata: {},
    awaitingHumanCount: 0,
    createdAt: "2026-05-28T00:00:00.000Z",
    iterationCount: 0,
    ...overrides,
  };
}

function renderWorkflows(initialPath: string, agents: AgentEntry[]) {
  const headerHost = document.createElement("div");
  document.body.appendChild(headerHost);
  return render(
    <HeaderActionsContext.Provider value={headerHost}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/runtime/workflows"
            element={<WorkflowsPage agents={agents} currentWorkspaceId="ws-1" />}
          />
        </Routes>
      </MemoryRouter>
    </HeaderActionsContext.Provider>,
  );
}

const PATH = "/workspaces/ws-1/runtime/workflows";
const agents = [makeAgent("official/engineer")];

beforeEach(() => {
  mockListWorkflows.mockReset();
  mockGetWorkflow.mockReset();
  mockGetWorkflowDag.mockReset();
  mockListWorkflows.mockResolvedValue([]);
  // Park the per-workflow detail fetch so an auto-selected row keeps the
  // detail pane on its skeleton instead of racing a real render.
  mockGetWorkflow.mockReturnValue(new Promise<WorkflowHeader>(() => {}));
  mockGetWorkflowDag.mockReturnValue(new Promise<WorkflowDag>(() => {}));
});

afterEach(() => cleanup());

describe("Workflows page — state matrix", () => {
  it("Loading: rail + detail both render skeletons during the initial list load", async () => {
    mockListWorkflows.mockReturnValue(new Promise<WorkflowHeader[]>(() => {}));
    renderWorkflows(PATH, agents);
    const railSkeleton = await screen.findByTestId("workflow-list-skeleton");
    // The detail-pane skeleton during INITIAL load: without it the pane
    // flashed the "No workflow selected" placeholder before the first row
    // auto-selected.
    const detailSkeleton = screen.getByTestId("workflow-detail-skeleton");
    expect(railSkeleton).toBeTruthy();
    expect(detailSkeleton).toBeTruthy();
  });

  it("Zero: empty workspace renders the 🪄 EmptyState with a wired New workflow CTA", async () => {
    mockListWorkflows.mockResolvedValue([]);
    // range=all so no time window is active: an empty list is a
    // genuinely-empty workspace (Zero), not a filtered-out result.
    renderWorkflows(`${PATH}?range=all`, agents);
    await screen.findByTestId("workflows-empty-zero");
    expect(screen.getByTestId("workflows-empty-zero-cta")).toBeTruthy();
  });

  it("No-match: an active filter with no rows renders the 🔍 EmptyState + Clear filters CTA", async () => {
    mockListWorkflows.mockResolvedValue([]);
    renderWorkflows(`${PATH}?q=missing&range=all`, agents);
    await screen.findByTestId("workflows-empty-nomatch");
    expect(screen.getByTestId("workflows-empty-nomatch-cta")).toBeTruthy();
    expect(screen.queryByTestId("workflows-empty-zero")).toBeNull();
  });

  it("No-match → Clear filters resets the filter URL (no-match collapses to zero)", async () => {
    mockListWorkflows.mockResolvedValue([]);
    renderWorkflows(`${PATH}?q=missing&range=all`, agents);
    fireEvent.click(await screen.findByTestId("workflows-empty-nomatch-cta"));
    await waitFor(() => {
      expect(screen.getByTestId("workflows-empty-zero")).toBeTruthy();
    });
    expect(screen.queryByTestId("workflows-empty-nomatch")).toBeNull();
  });

  it("Stale window: a populated workspace with all workflows outside the default window resolves to No-match, and Clear filters (→ range=all) recovers them", async () => {
    // The server applies the time window (createdSince), so the page only
    // ever sees the windowed slice. Model a populated-but-stale workspace:
    // empty while a window is active, rows once it widens to all-time.
    mockListWorkflows.mockImplementation((opts?: { createdSince?: string }) =>
      Promise.resolve(opts?.createdSince ? [] : [makeWorkflow({ id: "wf-1" })]),
    );
    // Default entry (range=7d) → createdSince sent → server returns []. The
    // window is an active filter, so this is No-match (recoverable), NOT
    // the genuinely-empty Zero state.
    renderWorkflows(PATH, agents);
    await screen.findByTestId("workflows-empty-nomatch");
    expect(screen.queryByTestId("workflows-empty-zero")).toBeNull();
    // Clear filters widens range to "all" → no createdSince → rows return.
    fireEvent.click(screen.getByTestId("workflows-empty-nomatch-cta"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-row-wf-1")).toBeTruthy();
    });
    expect(screen.queryByTestId("workflows-empty-nomatch")).toBeNull();
  });

  it("Normal: a populated, unfiltered list renders the rail rows (no empty card)", async () => {
    mockListWorkflows.mockResolvedValue([makeWorkflow({ id: "wf-1" })]);
    renderWorkflows(PATH, agents);
    await waitFor(() => {
      expect(screen.getByTestId("workflow-row-wf-1")).toBeTruthy();
    });
    expect(screen.queryByTestId("workflows-empty-zero")).toBeNull();
    expect(screen.queryByTestId("workflows-empty-nomatch")).toBeNull();
  });
});
