import type { AgentEntry } from "@glyphs-ai/sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ScheduleDetail as ScheduleDetailType,
  ScheduleView,
  WorkflowDag,
  WorkflowHeader,
} from "../src/api";

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listSchedules: vi.fn(),
    getSchedule: vi.fn(),
    previewSchedule: vi.fn(),
    patchSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    runSchedule: vi.fn(),
    listScheduledTasks: vi.fn(),
    listScheduledWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    getWorkflowDag: vi.fn(),
    getTask: vi.fn(),
    fetchTaskActivity: vi.fn(),
  };
});

import * as api from "../src/api";
import { SchedulesPage } from "../src/pages/Schedules";

const mockListSchedules = api.listSchedules as unknown as ReturnType<typeof vi.fn>;
const mockGetSchedule = api.getSchedule as unknown as ReturnType<typeof vi.fn>;
const mockPreviewSchedule = api.previewSchedule as unknown as ReturnType<typeof vi.fn>;
const mockPatchSchedule = api.patchSchedule as unknown as ReturnType<typeof vi.fn>;
const mockDeleteSchedule = api.deleteSchedule as unknown as ReturnType<typeof vi.fn>;
const mockRunSchedule = api.runSchedule as unknown as ReturnType<typeof vi.fn>;
const mockListScheduledTasks = api.listScheduledTasks as unknown as ReturnType<typeof vi.fn>;
const mockListScheduledWorkflows = api.listScheduledWorkflows as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetWorkflow = api.getWorkflow as unknown as ReturnType<typeof vi.fn>;
const mockGetWorkflowDag = api.getWorkflowDag as unknown as ReturnType<typeof vi.fn>;
const mockGetTask = api.getTask as unknown as ReturnType<typeof vi.fn>;
const mockFetchTaskActivity = api.fetchTaskActivity as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
}

const SAMPLE_VIEW: ScheduleView = {
  id: "sched-x",
  name: "Sample schedule",
  enabled: true,
  trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
  target: {
    kind: "task",
    agent: "official/engineer",
    brief: "Do the thing.",
    runtime: "copilot",
  },
  nextFireAt: "2026-05-30T09:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
};

const SAMPLE_DETAIL: ScheduleDetailType = { ...SAMPLE_VIEW, describe: "every day at 09:00" };

const SAMPLE_WF_VIEW: ScheduleView = {
  id: "sched-wf",
  name: "Release workflow",
  enabled: true,
  trigger: { kind: "cron", expr: "0 2 * * *", tz: "UTC" },
  target: {
    kind: "workflow",
    coordinatorAgent: "official/engineer",
    brief: "Coordinate the release train.",
  },
  nextFireAt: "2026-05-30T02:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
};

const SAMPLE_WF_DETAIL: ScheduleDetailType = { ...SAMPLE_WF_VIEW, describe: "every day at 02:00" };

const WF_FIRE: WorkflowHeader = {
  id: "wf-fire-1",
  brief: "Coordinate the release train.",
  status: "succeeded",
  origin: "schedule",
  coordinatorAgent: "official/engineer",
  metadata: { scheduleId: "sched-wf" },
  awaitingHumanCount: 0,
  createdAt: "2026-05-28T02:00:00Z",
  startedAt: "2026-05-28T02:00:01Z",
  endedAt: "2026-05-28T02:05:00Z",
  iterationCount: 1,
};

const WF_DAG: WorkflowDag = {
  workflow: WF_FIRE,
  nodes: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      workflowId: "wf-fire-1",
      status: "succeeded",
      phase: 0,
      spec: { kind: "coordinator", agent: "official/engineer" },
      metadata: {},
      createdAt: "2026-05-28T02:00:00Z",
      readyAt: "2026-05-28T02:00:00Z",
      runningAt: "2026-05-28T02:00:01Z",
      endedAt: "2026-05-28T02:05:00Z",
    },
  ],
  edges: [],
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/ws-1/runtime/schedules?scheduleId=sched-x"]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/runtime/schedules"
          element={
            <SchedulesPage agents={[makeAgent("official/engineer")]} currentWorkspaceId="ws-1" />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Mount the page at a workflow-kind schedule. `extraQuery` lets a test
 * append `&fireWorkflowId=…` to exercise the Mode B workflow pane
 * directly from the URL.
 */
function renderWorkflowDetail(extraQuery = "") {
  return render(
    <MemoryRouter
      initialEntries={[
        `/workspaces/ws-1/runtime/schedules?kind=workflow&scheduleId=sched-wf${extraQuery}`,
      ]}
    >
      <Routes>
        <Route
          path="/workspaces/:workspaceId/runtime/schedules"
          element={
            <SchedulesPage agents={[makeAgent("official/engineer")]} currentWorkspaceId="ws-1" />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Open the per-row `⋯` action menu for the given schedule id. Tests
 * call this before probing menuitems so the menu panel is mounted in
 * the DOM (the panel is conditional on `openMenuId === id`).
 */
async function openRowMenu(id: string) {
  fireEvent.click(await screen.findByTestId(`schedule-row-menu-trigger-${id}`));
  // The panel mounts synchronously on click; the await of the trigger
  // already serialised React's render. Use findByRole on the menu so
  // we surface a helpful error if the menu never opened.
  await screen.findByRole("menu");
}

beforeEach(() => {
  mockListSchedules.mockReset();
  mockGetSchedule.mockReset();
  mockPreviewSchedule.mockReset();
  mockPatchSchedule.mockReset();
  mockDeleteSchedule.mockReset();
  mockRunSchedule.mockReset();
  mockListScheduledTasks.mockReset();
  mockListScheduledWorkflows.mockReset();
  mockGetWorkflow.mockReset();
  mockGetWorkflowDag.mockReset();
  mockGetTask.mockReset();
  mockFetchTaskActivity.mockReset();
  mockListSchedules.mockResolvedValue([SAMPLE_VIEW]);
  mockGetSchedule.mockResolvedValue(SAMPLE_DETAIL);
  mockPreviewSchedule.mockResolvedValue({
    describe: SAMPLE_DETAIL.describe,
    nextRuns: ["2026-05-30T09:00:00.000Z", "2026-05-31T09:00:00.000Z", "2026-06-01T09:00:00.000Z"],
  });
  mockListScheduledTasks.mockResolvedValue([]);
  mockListScheduledWorkflows.mockResolvedValue([]);
  mockGetWorkflow.mockResolvedValue(WF_FIRE);
  mockGetWorkflowDag.mockResolvedValue(WF_DAG);
  mockGetTask.mockResolvedValue(null);
  mockFetchTaskActivity.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("Schedule detail panel", () => {
  it("renders the name, cron expression, tz, and describe", async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Sample schedule" })).toBeTruthy();
    });
    // The cron expression also appears in the list row on the left; the
    // detail header includes it at least once.
    expect(screen.getAllByText("0 9 * * *").length).toBeGreaterThan(0);
    expect(screen.getByText("UTC")).toBeTruthy();
    expect(screen.getByText(/every day at 09:00/)).toBeTruthy();
  });

  it("renders the next-fire header fact (single line) and previews n=1", async () => {
    renderDetail();
    // The next-fire fact lives in the header right column as a "Next fire X" line.
    const nextFireLine = await screen.findByTestId("schedule-detail-next-fire");
    expect(nextFireLine.textContent).toMatch(/Next fire/);
    // Preview only needs the very next run now that the body's "Next N fires"
    // section was removed — surfacing more than one would be wasted output.
    expect(mockPreviewSchedule).toHaveBeenCalledWith("sched-x", { n: 1 });
  });

  it("patches enabled=false when the Pause menuitem is clicked", async () => {
    mockPatchSchedule.mockResolvedValue({ ...SAMPLE_VIEW, enabled: false });
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Pause$/ }));
    await waitFor(() => {
      expect(mockPatchSchedule).toHaveBeenCalledWith("sched-x", { enabled: false });
    });
  });

  it("rolls back the optimistic toggle on patch failure", async () => {
    mockPatchSchedule.mockRejectedValue(new Error("server angry"));
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Pause$/ }));
    await waitFor(() => {
      expect(screen.getByText(/server angry/)).toBeTruthy();
    });
    // After rollback the row's badge reads "Enabled" again (enabled=true restored).
    // The badge is rendered inside ScheduleListItem; the test asserts on the
    // visible badge text rather than the menu (which closed on click).
    expect(screen.getAllByText(/Enabled/i).length).toBeGreaterThan(0);
  });

  it("renders the recent-fires panel with status / clock / duration / id", async () => {
    mockListScheduledTasks.mockResolvedValue([
      {
        id: "task-1",
        agent: "official/engineer",
        brief: "fire 1",
        origin: "schedule",
        status: "succeeded",
        metadata: { scheduleId: "sched-x" },
        createdAt: "2026-05-28T09:00:00Z",
        startedAt: "2026-05-28T09:00:01Z",
        endedAt: "2026-05-28T09:01:00Z",
      },
    ]);
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/Recent fires/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("task-1")).toBeTruthy();
    });
    // Dense row layout adds two new facts beyond the id: a status
    // badge and a wall-clock duration. The duration column reads
    // the difference between startedAt and endedAt — 59 seconds for
    // this fixture, formatted by `formatDuration` as "59s".
    expect(screen.getByText("59s")).toBeTruthy();
    // Status badge label comes from STATUS_LABEL.succeeded.
    expect(screen.getAllByText(/Succeeded/i).length).toBeGreaterThan(0);
  });

  it("calls runSchedule and surfaces errors when the Run now menuitem is clicked", async () => {
    mockRunSchedule.mockRejectedValue(new Error("dispatch blew up"));
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Run now$/ }));
    await waitFor(() => {
      expect(mockRunSchedule).toHaveBeenCalledWith("sched-x");
    });
    await waitFor(() => {
      expect(screen.getByText(/dispatch blew up/)).toBeTruthy();
    });
  });

  it("stays on the schedule page after a successful Run now and refreshes Recent fires", async () => {
    mockRunSchedule.mockResolvedValue({ dispatchId: "sched-x-run-1" });
    // Prime listScheduledTasks: first call returns empty, second returns the new fire.
    mockListScheduledTasks.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "sched-x-run-1",
        agent: "official/engineer",
        brief: "Sample schedule (manual run)",
        origin: "schedule",
        status: "running",
        metadata: { scheduleId: "sched-x" },
        createdAt: "2026-05-28T09:05:00Z",
        startedAt: "2026-05-28T09:05:01Z",
      },
    ]);
    renderDetail();
    // Wait for initial mount + initial fires fetch (empty list shown).
    await screen.findByText(/Recent fires/);
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Run now$/ }));
    // runSchedule was called.
    await waitFor(() => expect(mockRunSchedule).toHaveBeenCalledWith("sched-x"));
    // Recent fires got a refresh fetch (parent bumped recentFiresToken).
    await waitFor(() => expect(mockListScheduledTasks).toHaveBeenCalledTimes(2));
    // The new fire row eventually surfaces.
    await waitFor(() => expect(screen.getByText("sched-x-run-1")).toBeTruthy());
    // CRUCIALLY: we did NOT leave the schedule page. The row trigger is
    // still in the DOM (the row would unmount if we'd navigated away).
    expect(screen.getByTestId("schedule-row-menu-trigger-sched-x")).toBeTruthy();
  });

  it("opens the delete confirm modal when the Delete menuitem is clicked", async () => {
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/ }));
    // The modal renders inside the page-level host. The modal's dialog
    // role + title is the cleanest anchor since the body copy is split
    // across multiple text nodes.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /^Delete schedule$/ })).toBeTruthy();
  });

  it("calls deleteSchedule when the delete modal is confirmed", async () => {
    mockDeleteSchedule.mockResolvedValue({ deletedDispatchCount: 0 });
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/ }));
    const confirm = await screen.findByRole("button", { name: /Delete schedule/i });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(mockDeleteSchedule).toHaveBeenCalledWith("sched-x");
    });
  });

  it("shows a transient cascade-count notice after delete (count > 0)", async () => {
    mockDeleteSchedule.mockResolvedValue({ deletedDispatchCount: 3 });
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Delete schedule$/ }));
    const notice = await screen.findByTestId("schedules-delete-notice");
    expect(notice.textContent).toMatch(/Sample schedule/);
    expect(notice.textContent).toMatch(/3 historical dispatch runs also removed/);
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
  });

  it("singularises the cascade-count notice when exactly one dispatch was removed", async () => {
    mockDeleteSchedule.mockResolvedValue({ deletedDispatchCount: 1 });
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Delete schedule$/ }));
    const notice = await screen.findByTestId("schedules-delete-notice");
    expect(notice.textContent).toMatch(/1 historical dispatch run also removed/);
  });

  it("omits the cascade-count suffix when no dispatches were removed", async () => {
    mockDeleteSchedule.mockResolvedValue({ deletedDispatchCount: 0 });
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Delete schedule$/ }));
    const notice = await screen.findByTestId("schedules-delete-notice");
    expect(notice.textContent).toMatch(/Sample schedule.*deleted\.?$/);
    expect(notice.textContent).not.toMatch(/historical/);
  });

  it("surfaces a 'Last fired never' header line when lastFiredAt is null", async () => {
    // Sanity: the default SAMPLE_DETAIL above has no lastFiredAt set.
    renderDetail();
    const line = await screen.findByTestId("schedule-detail-last-fired");
    expect(line.textContent).toMatch(/Last fired/);
    expect(line.textContent).toMatch(/never/);
  });

  it("surfaces a 'Last fired …' header line when lastFiredAt is set", async () => {
    mockGetSchedule.mockResolvedValue({
      ...SAMPLE_DETAIL,
      lastFiredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    renderDetail();
    const line = await screen.findByTestId("schedule-detail-last-fired");
    expect(line.textContent).toMatch(/Last fired/);
    // formatRelative emits "1h ago" / "2h ago" — accept either to keep
    // the test resilient to rounding at the 5-second boundary.
    expect(line.textContent).toMatch(/h ago|m ago/);
  });

  it("opens the EditScheduleModal when the Edit menuitem is clicked", async () => {
    renderDetail();
    await openRowMenu("sched-x");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Edit$/ }));
    expect(await screen.findByTestId("edit-schedule-form")).toBeTruthy();
    expect((screen.getByTestId("edit-schedule-name") as HTMLInputElement).value).toBe(
      "Sample schedule",
    );
  });

  it("swaps to Mode B (fire-task detail pane) when a recent fire row is clicked", async () => {
    mockListScheduledTasks.mockResolvedValue([
      {
        id: "task-1",
        agent: "official/engineer",
        brief: "fire 1",
        origin: "schedule",
        status: "succeeded",
        metadata: { scheduleId: "sched-x" },
        createdAt: "2026-05-28T09:00:00Z",
        startedAt: "2026-05-28T09:00:01Z",
        endedAt: "2026-05-28T09:01:00Z",
      },
    ]);
    renderDetail();
    const fireRow = await screen.findByTestId("schedule-fire-row-task-1");
    fireEvent.click(fireRow);
    expect(await screen.findByTestId("fire-task-nav")).toBeTruthy();
    expect(screen.getByTestId("fire-task-back")).toBeTruthy();
  });

  it("renders workflow-kind recent fires via listScheduledWorkflows (not listScheduledTasks)", async () => {
    mockListSchedules.mockResolvedValue([SAMPLE_WF_VIEW]);
    mockGetSchedule.mockResolvedValue(SAMPLE_WF_DETAIL);
    mockListScheduledWorkflows.mockResolvedValue([WF_FIRE]);
    renderWorkflowDetail();
    await waitFor(() => expect(screen.getByText(/Recent fires/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("wf-fire-1")).toBeTruthy());
    // Workflow-kind schedules read the workflow fire history, never the task one.
    expect(mockListScheduledWorkflows).toHaveBeenCalled();
    expect(mockListScheduledTasks).not.toHaveBeenCalled();
    // The workflow status badge surfaces the lifecycle label.
    expect(screen.getAllByText(/Succeeded/i).length).toBeGreaterThan(0);
  });

  it("swaps to Mode B (fire-workflow detail pane) when a workflow fire row is clicked", async () => {
    mockListSchedules.mockResolvedValue([SAMPLE_WF_VIEW]);
    mockGetSchedule.mockResolvedValue(SAMPLE_WF_DETAIL);
    mockListScheduledWorkflows.mockResolvedValue([WF_FIRE]);
    renderWorkflowDetail();
    const fireRow = await screen.findByTestId("schedule-fire-row-wf-fire-1");
    fireEvent.click(fireRow);
    // The workflow detail view mounts (WorkflowView renders this testid),
    // and the shared Mode B nav pill is present.
    expect(await screen.findByTestId("workflow-detail")).toBeTruthy();
    expect(screen.getByTestId("fire-task-nav")).toBeTruthy();
    expect(mockGetWorkflow).toHaveBeenCalledWith("wf-fire-1");
  });

  it("shows the workflow 'Fire not found' notice for a stale ?fireWorkflowId", async () => {
    mockListSchedules.mockResolvedValue([SAMPLE_WF_VIEW]);
    mockGetSchedule.mockResolvedValue(SAMPLE_WF_DETAIL);
    // The recent-fires list does NOT contain the requested fire id.
    mockListScheduledWorkflows.mockResolvedValue([WF_FIRE]);
    renderWorkflowDetail("&fireWorkflowId=wf-aged-out");
    expect(await screen.findByTestId("fire-workflow-not-found")).toBeTruthy();
    // A stale id must never trigger a workflow detail fetch.
    expect(mockGetWorkflow).not.toHaveBeenCalled();
  });

  it("clicking a task-backed node in the fire-workflow Graph tab writes ?fireNodeId= and renders the node pane", async () => {
    const taskNodeId = "00000000-0000-4000-8000-000000000099";
    const dagWithTaskNode: WorkflowDag = {
      workflow: WF_FIRE,
      nodes: [
        ...WF_DAG.nodes,
        {
          id: taskNodeId,
          workflowId: "wf-fire-1",
          status: "succeeded",
          phase: 1,
          spec: { kind: "worker", agent: "official/engineer", brief: "Do the thing" },
          metadata: {},
          taskId: "task-abc",
          createdAt: "2026-05-28T02:01:00Z",
          readyAt: "2026-05-28T02:01:00Z",
          runningAt: "2026-05-28T02:01:01Z",
          endedAt: "2026-05-28T02:03:00Z",
        },
      ],
      edges: [],
    };
    mockListSchedules.mockResolvedValue([SAMPLE_WF_VIEW]);
    mockGetSchedule.mockResolvedValue(SAMPLE_WF_DETAIL);
    mockListScheduledWorkflows.mockResolvedValue([WF_FIRE]);
    mockGetWorkflow.mockResolvedValue(WF_FIRE);
    mockGetWorkflowDag.mockResolvedValue(dagWithTaskNode);
    renderWorkflowDetail(`&fireWorkflowId=${WF_FIRE.id}`);
    // Wait for the workflow detail to load.
    await screen.findByTestId("workflow-detail");
    // Switch to Graph tab.
    fireEvent.click(screen.getByTestId("workflow-tab-graph"));
    // Click the task-backed node.
    const nodeBtn = await screen.findByTestId(`dag-node-${taskNodeId}`);
    fireEvent.click(nodeBtn);
    // The URL should now contain fireNodeId — verify by checking that
    // the node task pane renders (replaces the workflow-detail view).
    await waitFor(() => {
      expect(screen.getByTestId("workflow-node-pane")).toBeTruthy();
    });
  });
});
