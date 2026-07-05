import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
    previewCron: vi.fn(),
    patchSchedule: vi.fn(),
    patchWorkflowSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    runSchedule: vi.fn(),
    listScheduledTasks: vi.fn(),
    listScheduledWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    getWorkflowDag: vi.fn(),
    getTask: vi.fn(),
    fetchTaskActivity: vi.fn(),
    listRuntimes: vi.fn(),
  };
});

import * as api from "../src/api";
import { SchedulesPage } from "../src/pages/Schedules";

const mockListSchedules = api.listSchedules as unknown as ReturnType<typeof vi.fn>;
const mockGetSchedule = api.getSchedule as unknown as ReturnType<typeof vi.fn>;
const mockPreviewSchedule = api.previewSchedule as unknown as ReturnType<typeof vi.fn>;
const mockPreviewCron = api.previewCron as unknown as ReturnType<typeof vi.fn>;
const mockPatchSchedule = api.patchSchedule as unknown as ReturnType<typeof vi.fn>;
const mockListScheduledTasks = api.listScheduledTasks as unknown as ReturnType<typeof vi.fn>;
const mockListScheduledWorkflows = api.listScheduledWorkflows as unknown as ReturnType<
  typeof vi.fn
>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
}

const VIEW_A: ScheduleView = {
  id: "sched-a",
  name: "Alpha report",
  enabled: true,
  trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
  target: { kind: "task", agent: "official/engineer", brief: "Do the thing.", runtime: "copilot" },
  nextFireAt: "2026-05-30T09:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
};

const VIEW_B: ScheduleView = {
  id: "sched-b",
  name: "Beta report",
  enabled: true,
  trigger: { kind: "cron", expr: "0 10 * * *", tz: "UTC" },
  target: {
    kind: "task",
    agent: "official/engineer",
    brief: "Do the other thing.",
    runtime: "copilot",
  },
  nextFireAt: "2026-05-30T10:00:00.000Z",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-20T00:00:00Z",
};

const DETAIL_BY_ID: Record<string, ScheduleDetailType> = {
  "sched-a": { ...VIEW_A, describe: "every day at 09:00" },
  "sched-b": { ...VIEW_B, describe: "every day at 10:00" },
};

/**
 * Surfaces `location.search` and offers a button that pushes a new
 * `?scheduleId=` — lets a test flip the effective selection through the
 * URL (rather than a row click) to prove the Edit modal survives a
 * selection change underneath it.
 */
function Probes() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="probe-search">{loc.search}</div>
      <button
        type="button"
        data-testid="nav-select-b"
        onClick={() => navigate("/workspaces/ws-1/runtime/schedules?scheduleId=sched-b")}
      >
        select B via URL
      </button>
    </>
  );
}

function renderPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId/runtime/schedules"
          element={
            <>
              <SchedulesPage agents={[makeAgent("official/engineer")]} currentWorkspaceId="ws-1" />
              <Probes />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the per-row `⋯` action menu so its Edit menuitem is mounted. */
async function openRowMenu(id: string) {
  fireEvent.click(await screen.findByTestId(`schedule-row-menu-trigger-${id}`));
  await screen.findByRole("menu");
}

function clickEditMenuItem() {
  fireEvent.click(screen.getByRole("menuitem", { name: /^Edit$/ }));
}

beforeEach(() => {
  for (const m of [
    mockListSchedules,
    mockGetSchedule,
    mockPreviewSchedule,
    mockPreviewCron,
    mockPatchSchedule,
    mockListScheduledTasks,
    mockListScheduledWorkflows,
    mockListRuntimes,
  ]) {
    m.mockReset();
  }
  mockListSchedules.mockResolvedValue([VIEW_A, VIEW_B]);
  mockGetSchedule.mockImplementation((id: string) => Promise.resolve(DETAIL_BY_ID[id] ?? null));
  mockPreviewSchedule.mockResolvedValue({ describe: "every day at 09:00", nextRuns: [] });
  mockPreviewCron.mockResolvedValue({ describe: "preview", nextRuns: [] });
  mockPatchSchedule.mockImplementation((id: string) => Promise.resolve(DETAIL_BY_ID[id] ?? null));
  mockListScheduledTasks.mockResolvedValue([]);
  mockListScheduledWorkflows.mockResolvedValue([]);
  mockListRuntimes.mockResolvedValue([{ kind: "copilot", capabilities: {} }]);
});

afterEach(() => cleanup());

describe("SchedulesPage — Edit modal vs row selection", () => {
  it("opens (and keeps open) the Edit modal for a row that is not the selected row", async () => {
    // A is the URL-pinned selection; B is a different, non-selected row.
    renderPage("/workspaces/ws-1/runtime/schedules?scheduleId=sched-a");

    await openRowMenu("sched-b");
    clickEditMenuItem();

    // The modal opens for B and STAYS open. Previously a selection-mismatch
    // effect (editTarget.id !== effectiveSelectedId) wiped editTarget on the
    // very next render, so the modal flashed open and immediately closed.
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toContain("Beta report");
    // Fields seed from B — proof the modal targets schedule.id === "sched-b".
    expect((within(dialog).getByTestId("edit-schedule-name") as HTMLInputElement).value).toBe(
      "Beta report",
    );
    // Editing did NOT change the selection (no URL flip to sched-b).
    expect(screen.getByTestId("probe-search").textContent).toContain("scheduleId=sched-a");
  });

  it("keeps the Edit modal open when the ?scheduleId= URL changes underneath it", async () => {
    renderPage("/workspaces/ws-1/runtime/schedules?scheduleId=sched-a");

    await openRowMenu("sched-a");
    clickEditMenuItem();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain("Alpha report");

    // Flip the effective selection through the URL — the change the deleted
    // effect used to react to by closing the modal.
    fireEvent.click(screen.getByTestId("nav-select-b"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-search").textContent).toContain("scheduleId=sched-b");
    });

    // Modal is still mounted and still editing A.
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toContain("Alpha report");
    expect((within(dialog).getByTestId("edit-schedule-name") as HTMLInputElement).value).toBe(
      "Alpha report",
    );
  });

  it("closes the Edit modal via the modal's own Close button", async () => {
    renderPage("/workspaces/ws-1/runtime/schedules?scheduleId=sched-a");

    await openRowMenu("sched-a");
    clickEditMenuItem();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("submits the Edit modal (patchSchedule) and closes it on success", async () => {
    renderPage("/workspaces/ws-1/runtime/schedules?scheduleId=sched-a");

    await openRowMenu("sched-a");
    clickEditMenuItem();
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByTestId("edit-schedule-name"), {
      target: { value: "Alpha report v2" },
    });
    const save = await waitFor(() => {
      const btn = within(dialog).getByTestId("edit-schedule-submit") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    fireEvent.click(save);

    await waitFor(() => {
      expect(mockPatchSchedule).toHaveBeenCalledWith("sched-a", { name: "Alpha report v2" });
    });
    // The page wires onPatched + onClose so a successful PATCH dismisses the modal.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  // Brief case 2 (stateFilter=Enabled, A enabled + B paused, edit B from the
  // row menu) is intentionally NOT implemented as a live test. Under
  // `?state=enabled` the paused row B is excluded from `visible`, so B's row —
  // and with it the `⋯` menu and its Edit item, the only Edit affordance — is
  // never mounted (see SchedulesListPage.test.tsx "state chip filters by
  // enabled"). The scenario is therefore unreachable through the row menu, so
  // there is nothing to drive. The underlying code path it was meant to guard
  // (editTarget.id !== effectiveSelectedId) is fully exercised by the first
  // test above, which edits a non-selected row.
});
