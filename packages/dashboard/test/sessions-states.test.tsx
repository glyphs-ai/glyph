import type { AgentEntry } from "@glyphs-ai/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData, ServerConfig, SessionView, WorkspaceListItem } from "../src/api";
import {
  WorkspaceShellContext,
  type WorkspaceShellContextValue,
} from "../src/components/WorkspaceShellContext";
import { SessionsPage } from "../src/pages/Sessions";

/**
 * State-matrix lock-in for the Sessions page. Sessions is single-column,
 * so the matrix collapses to four named states — Loading, Zero, No-match,
 * Normal — each rendered through the shared `<EmptyState>` (no detail
 * pane, so no "unselected"), plus a stale-time-window regression (a
 * populated workspace whose sessions all predate the default window
 * resolves to No-match, not Zero). DOM snapshots pin the empty cards so a
 * future refactor can't silently regress them.
 */

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listSessions: vi.fn(),
    listRuntimes: vi.fn(),
  };
});

import * as api from "../src/api";

const mockListSessions = api.listSessions as unknown as ReturnType<typeof vi.fn>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
}

function makeSession(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: "sess-1",
    agent: "official/engineer",
    runtime: "copilot",
    runtimeSessionId: null,
    lastActiveAt: null,
    createdAt: "2026-05-23T00:00:00Z",
    workdir: "/tmp/w",
    lastLaunchMode: null,
    ...overrides,
  } as unknown as SessionView;
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

function renderSessions(initialPath: string, agents: AgentEntry[]) {
  const value = shellValue(agents);
  const workspaces: WorkspaceListItem[] = [];
  return render(
    <WorkspaceShellContext.Provider value={value}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId/runtime/sessions"
            element={
              <SessionsPage
                agents={agents}
                config={value.config}
                currentWorkspaceId={value.workspaceId}
                workspaces={workspaces}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </WorkspaceShellContext.Provider>,
  );
}

const PATH = "/workspaces/ws-1/runtime/sessions";
const agents = [makeAgent("official/engineer")];

beforeEach(() => {
  mockListSessions.mockReset();
  mockListRuntimes.mockReset();
  mockListSessions.mockResolvedValue([] as SessionView[]);
  mockListRuntimes.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("Sessions page — state matrix", () => {
  it("Loading: shows the spinner EmptyState while the list fetch is pending", async () => {
    mockListSessions.mockReturnValue(new Promise<SessionView[]>(() => {}));
    renderSessions(PATH, agents);
    const loading = await screen.findByTestId("sessions-loading");
    expect(loading).toBeTruthy();
    expect(loading.querySelector(".spin")).toBeTruthy();
    expect(loading).toMatchSnapshot();
  });

  it("Zero: empty workspace renders the 📂 EmptyState with a wired New session CTA", async () => {
    mockListSessions.mockResolvedValue([]);
    // range=all so no time window is active: an empty list is a
    // genuinely-empty workspace (Zero), not a filtered-out result.
    renderSessions(`${PATH}?range=all`, agents);
    const zero = await screen.findByTestId("sessions-empty-zero");
    const cta = screen.getByTestId("sessions-empty-zero-cta");
    expect(cta).toBeTruthy();
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    expect(zero).toMatchSnapshot();
  });

  it("No-match: a filter that hides every row renders the 🔍 EmptyState + Clear filters CTA", async () => {
    mockListSessions.mockResolvedValue([makeSession({ id: "sess-1" })]);
    renderSessions(`${PATH}?q=zzz`, agents);
    const nomatch = await screen.findByTestId("sessions-empty-nomatch");
    expect(screen.getByTestId("sessions-empty-nomatch-cta")).toBeTruthy();
    expect(screen.queryByTestId("sessions-empty-zero")).toBeNull();
    expect(nomatch).toMatchSnapshot();
  });

  it("No-match → Clear filters reveals the hidden row (URL filter reset)", async () => {
    mockListSessions.mockResolvedValue([makeSession({ id: "sess-1" })]);
    renderSessions(`${PATH}?q=zzz`, agents);
    fireEvent.click(await screen.findByTestId("sessions-empty-nomatch-cta"));
    await waitFor(() => {
      expect(screen.queryByTestId("sessions-empty-nomatch")).toBeNull();
    });
    expect(screen.getByLabelText("Sessions")).toBeTruthy();
  });

  it("Stale window: a populated workspace with all sessions outside the default window resolves to No-match, and Clear filters (→ range=all) recovers them", async () => {
    // The server applies the time window (activeSince), so the page only
    // ever sees the windowed slice. Model a populated-but-stale workspace:
    // empty while a window is active, rows once it widens to all-time.
    mockListSessions.mockImplementation((opts?: { activeSince?: string }) =>
      Promise.resolve(opts?.activeSince ? [] : [makeSession({ id: "sess-1" })]),
    );
    // Default entry (range=7d) → activeSince sent → server returns []. The
    // window is an active filter, so this is No-match (recoverable), NOT
    // the genuinely-empty Zero state.
    renderSessions(PATH, agents);
    await screen.findByTestId("sessions-empty-nomatch");
    expect(screen.queryByTestId("sessions-empty-zero")).toBeNull();
    // Clear filters widens range to "all" → no activeSince → rows return.
    fireEvent.click(screen.getByTestId("sessions-empty-nomatch-cta"));
    await waitFor(() => {
      expect(screen.queryByTestId("sessions-empty-nomatch")).toBeNull();
    });
    expect(screen.getByLabelText("Sessions")).toBeTruthy();
  });

  it("Normal: a populated, unfiltered list renders the session list (no empty card)", async () => {
    mockListSessions.mockResolvedValue([makeSession({ id: "sess-1" })]);
    renderSessions(PATH, agents);
    await waitFor(() => {
      expect(screen.getByLabelText("Sessions")).toBeTruthy();
    });
    expect(screen.queryByTestId("sessions-empty-zero")).toBeNull();
    expect(screen.queryByTestId("sessions-empty-nomatch")).toBeNull();
    expect(screen.queryByTestId("sessions-loading")).toBeNull();
  });
});
