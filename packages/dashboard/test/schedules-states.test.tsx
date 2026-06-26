import type { AgentEntry } from "@glyphs-ai/sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleView } from "../src/api";

/**
 * State-matrix lock-in for the Schedules page (two-pane). Covers the four
 * user-reachable named states — Loading, Zero, No-match, Normal — and pins
 * the layout reshape: the `tasks-pane--zero` whole-page switch is gone, so
 * the filter chrome stays mounted and the empty cards live in the detail
 * pane. "Unselected" is unreachable (auto-bind), so it collapses to Normal
 * and is exercised by the Normal-state cases below. Each reachable state is
 * pinned by explicit testid presence/absence + CTA assertions below; the
 * brittle DOM snapshots were dropped this round.
 */

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listSchedules: vi.fn(),
    getSchedule: vi.fn(),
    previewSchedule: vi.fn(),
    listScheduledTasks: vi.fn(),
    listRuntimes: vi.fn(),
  };
});

import * as api from "../src/api";
import { HeaderActionsContext } from "../src/components/HeaderActions";
import { SchedulesPage } from "../src/pages/Schedules";

const mockListSchedules = api.listSchedules as unknown as ReturnType<typeof vi.fn>;
const mockGetSchedule = api.getSchedule as unknown as ReturnType<typeof vi.fn>;
const mockPreviewSchedule = api.previewSchedule as unknown as ReturnType<typeof vi.fn>;
const mockListScheduledTasks = api.listScheduledTasks as unknown as ReturnType<typeof vi.fn>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
}

function makeTaskSchedule(id: string, name: string): ScheduleView {
  return {
    id,
    name,
    enabled: true,
    trigger: { kind: "cron", expr: "0 1 * * *", tz: "UTC" },
    target: { kind: "task", agent: "official/engineer", brief: "do" },
    nextFireAt: "2026-06-01T01:00:00.000Z",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-20T00:00:00Z",
  } as unknown as ScheduleView;
}

function renderSchedules(initialPath: string, agents: AgentEntry[]) {
  const headerHost = document.createElement("div");
  document.body.appendChild(headerHost);
  return render(
    <HeaderActionsContext.Provider value={headerHost}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/runtime/schedules"
            element={<SchedulesPage agents={agents} currentWorkspaceId="ws-1" />}
          />
        </Routes>
      </MemoryRouter>
    </HeaderActionsContext.Provider>,
  );
}

const PATH = "/workspaces/ws-1/runtime/schedules";
const agents = [makeAgent("official/engineer")];

beforeEach(() => {
  mockListSchedules.mockReset();
  mockGetSchedule.mockReset();
  mockPreviewSchedule.mockReset();
  mockListScheduledTasks.mockReset();
  mockListRuntimes.mockReset();
  mockListSchedules.mockResolvedValue([]);
  // Park the per-schedule detail fetch so an auto-selected row keeps the
  // detail pane parked rather than racing a real render.
  mockGetSchedule.mockReturnValue(new Promise(() => {}));
  mockPreviewSchedule.mockResolvedValue({ describe: "test", nextRuns: [] });
  mockListScheduledTasks.mockResolvedValue([]);
  mockListRuntimes.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("Schedules page — state matrix", () => {
  it("Loading: rail + detail both render skeletons while the list fetch is pending", async () => {
    mockListSchedules.mockReturnValue(new Promise<ScheduleView[]>(() => {}));
    renderSchedules(PATH, agents);
    const railSkeleton = await screen.findByTestId("schedules-list-skeleton");
    const detailSkeleton = screen.getByTestId("schedule-detail-skeleton");
    expect(railSkeleton).toBeTruthy();
    expect(detailSkeleton).toBeTruthy();
  });

  it("Zero: empty workspace renders the 📅 EmptyState (New schedule CTA) with the filter chrome still mounted", async () => {
    mockListSchedules.mockResolvedValue([]);
    renderSchedules(PATH, agents);
    await screen.findByTestId("schedules-empty-zero");
    expect(screen.getByTestId("schedules-empty-zero-cta")).toBeTruthy();
    // The reshape contract: the page no longer collapses to a full-width
    // `tasks-pane--zero`; the standard two-pane layout stays mounted.
    expect(document.querySelector(".tasks-pane--zero")).toBeNull();
    expect(document.querySelector(".tasks-pane--with-detail")).toBeTruthy();
  });

  it("No-match: a filter hiding every row renders the 🔍 EmptyState + Clear filters CTA", async () => {
    mockListSchedules.mockResolvedValue([makeTaskSchedule("sched-t", "Task schedule")]);
    renderSchedules(`${PATH}?q=zzz`, agents);
    await screen.findByTestId("schedules-empty-nomatch");
    expect(screen.getByTestId("schedules-empty-nomatch-cta")).toBeTruthy();
    expect(screen.queryByTestId("schedules-empty-zero")).toBeNull();
  });

  it("No-match → Clear filters reveals the hidden row (URL filter reset)", async () => {
    mockListSchedules.mockResolvedValue([makeTaskSchedule("sched-t", "Task schedule")]);
    renderSchedules(`${PATH}?q=zzz`, agents);
    fireEvent.click(await screen.findByTestId("schedules-empty-nomatch-cta"));
    await waitFor(() => {
      expect(screen.getByTestId("schedule-row-sched-t")).toBeTruthy();
    });
    expect(screen.queryByTestId("schedules-empty-nomatch")).toBeNull();
  });

  it("Normal: a populated, unfiltered list renders the rail rows (no empty card)", async () => {
    mockListSchedules.mockResolvedValue([makeTaskSchedule("sched-t", "Task schedule")]);
    renderSchedules(PATH, agents);
    await waitFor(() => {
      expect(screen.getByTestId("schedule-row-sched-t")).toBeTruthy();
    });
    expect(screen.queryByTestId("schedules-empty-zero")).toBeNull();
    expect(screen.queryByTestId("schedules-empty-nomatch")).toBeNull();
  });
});
