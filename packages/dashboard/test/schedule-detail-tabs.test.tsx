import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleDetail as ScheduleDetailType, ScheduleView } from "../src/api";
import type { AgentEntry } from "../src/api/catalog.js";

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
  target: { kind: "task", agent: "official/engineer", brief: "Do the thing.", runtime: "copilot" },
  nextFireAt: "2026-05-30T09:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
};

const SAMPLE_DETAIL: ScheduleDetailType = { ...SAMPLE_VIEW, describe: "every day at 09:00" };

const SAMPLE_DETAIL_WITH_DETAILS: ScheduleDetailType = {
  ...SAMPLE_VIEW,
  describe: "every day at 09:00",
  target: {
    kind: "task",
    agent: "official/engineer",
    brief: "Do the thing.",
    runtime: "copilot",
    details: "Step one\nStep two",
  },
};

const SAMPLE_WF_VIEW: ScheduleView = {
  id: "sched-wf",
  name: "Release workflow",
  enabled: true,
  trigger: { kind: "cron", expr: "0 2 * * *", tz: "UTC" },
  target: { kind: "workflow", coordinatorAgent: "official/engineer", brief: "Coordinate." },
  nextFireAt: "2026-05-30T02:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
  fireStats: { awaitingCount: 0, runningCount: 0 },
} as ScheduleView;

const SAMPLE_WF_DETAIL: ScheduleDetailType = { ...SAMPLE_WF_VIEW, describe: "every day at 02:00" };

const TASK_FIRE = {
  id: "task-1",
  agent: "official/engineer",
  brief: "fire 1",
  origin: "schedule",
  status: "succeeded",
  metadata: { scheduleId: "sched-x" },
  createdAt: "2026-05-28T09:00:00Z",
  startedAt: "2026-05-28T09:00:01Z",
  endedAt: "2026-05-28T09:01:00Z",
};

const WF_FIRE = {
  id: "wf-fire-1",
  brief: "Coordinate.",
  status: "succeeded",
  origin: "schedule",
  coordinatorAgent: "official/engineer",
  metadata: { scheduleId: "sched-wf" },
  createdAt: "2026-05-28T02:00:00Z",
  startedAt: "2026-05-28T02:00:01Z",
  endedAt: "2026-05-28T02:05:00Z",
};

/**
 * Probe that surfaces `location.search` so a test can assert the page
 * wrote (or cleared) the `?tab=` query param.
 */
function SearchProbe() {
  const loc = useLocation();
  return <div data-testid="probe-search">{loc.search}</div>;
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/runtime/schedules"
          element={
            <>
              <SchedulesPage agents={[makeAgent("official/engineer")]} currentWorkspaceId="ws-1" />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const m of [
    mockListSchedules,
    mockGetSchedule,
    mockPreviewSchedule,
    mockListScheduledTasks,
    mockListScheduledWorkflows,
    mockGetWorkflow,
    mockGetWorkflowDag,
    mockGetTask,
    mockFetchTaskActivity,
  ]) {
    m.mockReset();
  }
  mockListSchedules.mockResolvedValue([SAMPLE_VIEW]);
  mockGetSchedule.mockResolvedValue(SAMPLE_DETAIL);
  mockPreviewSchedule.mockResolvedValue({
    describe: SAMPLE_DETAIL.describe,
    nextRuns: ["2026-05-30T09:00:00.000Z"],
  });
  mockListScheduledTasks.mockResolvedValue([]);
  mockListScheduledWorkflows.mockResolvedValue([]);
  mockGetWorkflow.mockResolvedValue(WF_FIRE);
  mockGetWorkflowDag.mockResolvedValue({ workflow: WF_FIRE, nodes: [], edges: [] });
  mockGetTask.mockResolvedValue(null);
  mockFetchTaskActivity.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("schedule-detail-tabs", () => {
  it("defaults to the Recent fires tab and does not render the Spec panel", async () => {
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x");
    expect(await screen.findByTestId("schedule-detail-tabs")).toBeTruthy();
    expect(screen.getByTestId("schedule-detail-tab-fires").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("schedule-detail-panel-fires")).toBeTruthy();
    expect(screen.queryByTestId("schedule-detail-panel-spec")).toBeNull();
  });

  it("flips to the Spec tab on click, rendering Brief + Details and hiding the fires panel", async () => {
    mockGetSchedule.mockResolvedValue(SAMPLE_DETAIL_WITH_DETAILS);
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x");
    fireEvent.click(await screen.findByTestId("schedule-detail-tab-spec"));
    expect(screen.getByTestId("schedule-detail-panel-spec")).toBeTruthy();
    expect(screen.getByTestId("schedule-detail-brief-card")).toBeTruthy();
    expect(screen.getByTestId("schedule-detail-details-card")).toBeTruthy();
    expect(screen.queryByTestId("schedule-detail-panel-fires")).toBeNull();
    expect(screen.getByTestId("schedule-detail-tab-spec").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("writes ?tab=spec when Spec is selected and clears it when returning to fires", async () => {
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x");
    fireEvent.click(await screen.findByTestId("schedule-detail-tab-spec"));
    expect(screen.getByTestId("probe-search").textContent).toContain("tab=spec");
    fireEvent.click(screen.getByTestId("schedule-detail-tab-fires"));
    expect(screen.getByTestId("probe-search").textContent).not.toContain("tab=");
  });

  it("honours ?tab=spec on mount (reload preserves the selected tab)", async () => {
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x&tab=spec");
    expect(await screen.findByTestId("schedule-detail-panel-spec")).toBeTruthy();
    expect(screen.getByTestId("schedule-detail-tab-spec").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByTestId("schedule-detail-panel-fires")).toBeNull();
  });

  it("shows the (N) count on the fires tab only after the fire history resolves", async () => {
    let resolveTasks!: (rows: unknown[]) => void;
    mockListScheduledTasks.mockReturnValue(
      new Promise<unknown[]>((res) => {
        resolveTasks = res;
      }),
    );
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x");
    const firesTab = await screen.findByTestId("schedule-detail-tab-fires");
    // While the fetch is in flight the badge carries no count, never "(0)".
    expect(firesTab.textContent).toBe("Recent fires");
    resolveTasks([TASK_FIRE]);
    await waitFor(() => {
      expect(screen.getByTestId("schedule-detail-tab-fires").textContent).toBe("Recent fires (1)");
    });
  });

  it("renders the workflow fire history inside the tab for a workflow-kind schedule", async () => {
    mockListSchedules.mockResolvedValue([SAMPLE_WF_VIEW]);
    mockGetSchedule.mockResolvedValue(SAMPLE_WF_DETAIL);
    mockListScheduledWorkflows.mockResolvedValue([WF_FIRE]);
    renderAt("/workspaces/ws-1/runtime/schedules?kind=workflow&scheduleId=sched-wf");
    expect(await screen.findByTestId("schedule-detail-panel-fires")).toBeTruthy();
    expect(await screen.findByText("wf-fire-1")).toBeTruthy();
    // Workflow-kind schedules read the workflow fire history, never the task list.
    expect(mockListScheduledTasks).not.toHaveBeenCalled();
  });

  it("shows only the Brief card on the Spec tab when the target carries no details", async () => {
    renderAt("/workspaces/ws-1/runtime/schedules?scheduleId=sched-x&tab=spec");
    expect(await screen.findByTestId("schedule-detail-brief-card")).toBeTruthy();
    expect(screen.queryByTestId("schedule-detail-details-card")).toBeNull();
  });
});
