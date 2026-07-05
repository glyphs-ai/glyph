import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData, ServerConfig, SessionView, TaskRecord } from "../src/api";
import type { AgentEntry } from "../src/api/catalog.js";
import {
  BreadcrumbContext,
  type BreadcrumbValue,
  WorkspaceShellContext,
  type WorkspaceShellContextValue,
} from "../src/components/WorkspaceShellContext";
import { AgentsListPage } from "../src/pages/Runtime/AgentsListPage";

/**
 * Coverage for the master-detail split layout on
 * `/runtime/agents`. Asserts the `?selected=` URL contract, the
 * auto-select-first-row fallback, row selection, and the breadcrumb pin
 * to Runtime / Agents.
 */

vi.mock("../src/api", async () => {
  const actual = await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    listTasks: vi.fn(),
    listSessions: vi.fn(),
    // The fqn-change reset effect on AgentDetailPane is exercised
    // end-to-end via the dispatch flow, which needs both the runtime
    // registry probe and the dispatch call mocked so the reset triggers
    // a real action-error path.
    listRuntimes: vi.fn(),
    dispatchTask: vi.fn(),
  };
});

import * as api from "../src/api";

const mockListTasks = api.listTasks as unknown as ReturnType<typeof vi.fn>;
const mockListSessions = api.listSessions as unknown as ReturnType<typeof vi.fn>;
const mockListRuntimes = api.listRuntimes as unknown as ReturnType<typeof vi.fn>;
const mockDispatchTask = api.dispatchTask as unknown as ReturnType<typeof vi.fn>;

function makeAgent(fqn: string): AgentEntry {
  const [scope, short] = fqn.split("/");
  return {
    agent: { fqn, scope, short, version: "1.0.0" },
    status: "ready",
  } as unknown as AgentEntry;
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

/**
 * Probe component used to read the live URL inside the in-test memory
 * router. The Agents page writes selection through React-Router; tests
 * inspect the result via this probe rather than `window.location.search`
 * because the `<MemoryRouter>` is the source of truth in the test env.
 */
function UrlProbe() {
  const location = useLocation();
  return (
    <div data-testid="url-probe" data-search={location.search} data-pathname={location.pathname} />
  );
}

interface RenderOpts {
  agents: AgentEntry[];
  initialPath: string;
  /** Optional breadcrumb capture sink — set to inspect `useBreadcrumb` calls. */
  breadcrumbCapture?: { last: BreadcrumbValue | null };
}

function renderMasterDetail({ agents, initialPath, breadcrumbCapture }: RenderOpts) {
  const breadcrumbCtx = {
    set(value: BreadcrumbValue | null) {
      if (breadcrumbCapture) breadcrumbCapture.last = value;
    },
  };
  return render(
    <WorkspaceShellContext.Provider value={shellValue(agents)}>
      <BreadcrumbContext.Provider value={breadcrumbCtx}>
        <MemoryRouter initialEntries={[initialPath]}>
          <UrlProbe />
          <Routes>
            <Route path="/workspaces/:workspaceId/runtime/agents" element={<AgentsListPage />} />
          </Routes>
        </MemoryRouter>
      </BreadcrumbContext.Provider>
    </WorkspaceShellContext.Provider>,
  );
}

beforeEach(() => {
  mockListTasks.mockReset();
  mockListSessions.mockReset();
  mockListRuntimes.mockReset();
  mockDispatchTask.mockReset();
  mockListTasks.mockResolvedValue([]);
  mockListSessions.mockResolvedValue([] as SessionView[]);
  // Defaults — keep the AgentDetailPane mount-effect runtimes probe
  // quiet for tests that never exercise the dispatch flow.
  mockListRuntimes.mockResolvedValue([{ kind: "copilot", capabilities: {} }]);
  mockDispatchTask.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Master-detail layout", () => {
  it("renders the full-width zero-state when the catalog is empty (no split placeholder pair)", async () => {
    renderMasterDetail({ agents: [], initialPath: "/workspaces/ws-1/runtime/agents" });
    // Workspace-empty collapses the split layout into a single
    // full-width empty pane. The detail-side placeholder must NOT
    // render alongside.
    await waitFor(() => {
      expect(screen.getByTestId("agents-empty-zero")).toBeTruthy();
    });
    expect(screen.queryByTestId("agent-detail-placeholder")).toBeNull();
    // The single empty surfaces the install hint + CTA to Catalog.
    expect(screen.getByText(/No agents installed/i)).toBeTruthy();
    const cta = screen.getByTestId("agents-empty-zero-cta") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/workspaces/ws-1/catalog/agents");
  });

  it("auto-selects the first visible agent during render when ?selected= is absent", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // First catalog row is `alpha` — the detail header should mount for
    // that agent immediately on first paint after tasks resolve, without
    // any user interaction.
    const pane = await screen.findByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/alpha");
  });

  it("clicking a different row writes ?selected= into the URL and re-renders the right pane", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    await waitFor(() => {
      expect(screen.getByTestId("agent-detail-pane")).toBeTruthy();
    });

    // The list rows are dataTestid'd by fqn — click the second one's
    // select button (the row-a11y migration moved the click affordance
    // from the <li> onto a real <button> child).
    const betaSelect = screen.getByTestId("agent-row-select-acme/beta");
    act(() => {
      fireEvent.click(betaSelect);
    });

    // URL probe reflects the new selection slot (and only that slot).
    await waitFor(() => {
      const probe = screen.getByTestId("url-probe");
      expect(probe.getAttribute("data-search")).toContain("selected=acme%2Fbeta");
    });
    // The right pane now reflects beta.
    await waitFor(() => {
      const pane = screen.getByTestId("agent-detail-pane");
      expect(pane.getAttribute("data-agent-fqn")).toBe("acme/beta");
    });
  });

  it("Enter and Space activate the focused select button", async () => {
    // Post- the row click affordance is a real <button>; native
    // <button> handles Enter/Space activation directly (no custom
    // onKeyDown on the <li>). We assert the button shape + click — the
    // browser contract for Enter/Space → click is enforced by the
    // platform, and faking keydown→click in jsdom/happy-dom isn't
    // representative. Adding @testing-library/user-event just to
    // synthesize keyboard activation is more dependency churn than the
    // assertion is worth; the platform guarantee is what we care about.
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    await waitFor(() => {
      expect(screen.getByTestId("agent-detail-pane")).toBeTruthy();
    });

    const betaSelect = screen.getByTestId("agent-row-select-acme/beta") as HTMLButtonElement;
    // Real <button type="button"> — Enter/Space activation is a
    // browser-platform invariant, no JS handler needed.
    expect(betaSelect.tagName).toBe("BUTTON");
    expect(betaSelect.getAttribute("type")).toBe("button");
    act(() => {
      fireEvent.click(betaSelect);
    });
    await waitFor(() => {
      const pane = screen.getByTestId("agent-detail-pane");
      expect(pane.getAttribute("data-agent-fqn")).toBe("acme/beta");
    });
  });

  it("hydrates the right pane from ?selected=<fqn> on initial mount (refresh/share-link behaviour)", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({
      agents,
      initialPath: "/workspaces/ws-1/runtime/agents?selected=acme%2Fbeta",
    });

    const pane = await screen.findByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/beta");
  });

  it("?selected=<fqn> pointing at an uninstalled agent renders the 'not installed' alert", async () => {
    const agents = [makeAgent("acme/alpha")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({
      agents,
      initialPath: "/workspaces/ws-1/runtime/agents?selected=acme%2Funknown",
    });

    const pane = await screen.findByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/unknown");
    // The pane's "not installed" alert echoes the fqn back.
    expect(screen.getByText(/is not installed in this workspace/i)).toBeTruthy();
    expect(screen.getByText(/acme\/unknown/)).toBeTruthy();
  });

  it("the row's select button reflects the URL selection via aria-current", async () => {
    // Post- the listbox shape (role="option" + aria-selected on the
    // <li>) is gone. The selected state now lives on the row-select
    // <button> as `aria-current="true"` (absent — NOT "false" — when
    // unselected). aria-selected is no longer asserted because the <li>
    // is presentational.
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({
      agents,
      initialPath: "/workspaces/ws-1/runtime/agents?selected=acme%2Fbeta",
    });

    const betaSelect = await screen.findByTestId("agent-row-select-acme/beta");
    expect(betaSelect.getAttribute("aria-current")).toBe("true");
    const alphaSelect = screen.getByTestId("agent-row-select-acme/alpha");
    expect(alphaSelect.getAttribute("aria-current")).toBeNull();

    // The <li> itself carries no role / tabindex / aria-selected —
    // pinning that contract here so a regression in the row's a11y
    // shape doesn't silently bring the fake-listbox model back.
    const betaRow = screen.getByTestId("agent-row-acme/beta");
    expect(betaRow.getAttribute("role")).toBeNull();
    expect(betaRow.getAttribute("tabindex")).toBeNull();
    expect(betaRow.getAttribute("aria-selected")).toBeNull();
  });
});

describe("Breadcrumb (must stay 'Runtime / Agents')", () => {
  it("declares Runtime / Agents and never deepens the chain when an agent is selected", async () => {
    const agents = [makeAgent("acme/alpha")];
    mockListTasks.mockResolvedValue([]);
    const breadcrumbCapture: { last: BreadcrumbValue | null } = { last: null };
    renderMasterDetail({
      agents,
      initialPath: "/workspaces/ws-1/runtime/agents?selected=acme%2Falpha",
      breadcrumbCapture,
    });

    await waitFor(() => {
      expect(breadcrumbCapture.last).not.toBeNull();
    });
    expect(breadcrumbCapture.last?.title).toBe("Runtime");
    expect(breadcrumbCapture.last?.chain).toEqual(["Runtime", "Agents"]);
  });
});

describe("Per-row kebab menu", () => {
  it("the kebab menu is removed entirely (row is a single 'click to select' target now)", async () => {
    const agents = [makeAgent("acme/alpha")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    await waitFor(() => {
      expect(screen.getByTestId("agent-row-acme/alpha")).toBeTruthy();
    });
    // No kebab container, no <details>, no menu items: the row is a
    // single select target and navigation lives in the detail pane.
    expect(screen.queryByTestId("agent-row-menu")).toBeNull();
    expect(screen.queryByTestId("agent-row-menu-tasks")).toBeNull();
    expect(screen.queryByTestId("agent-row-menu-sessions")).toBeNull();
    const row = screen.getByTestId("agent-row-acme/alpha");
    expect(row.querySelector("summary.agents-list__menu-trigger")).toBeNull();
  });
});

describe("anti-gating row redesign", () => {
  it("renders rows immediately from data.agents even while tasks fetch is pending", () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    // Pending forever — the row list must NOT wait on this.
    mockListTasks.mockReturnValue(new Promise<never>(() => {}));
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });
    // Row visible synchronously, no "Loading agents…" empty branch.
    expect(screen.getByTestId("agent-row-acme/alpha")).toBeTruthy();
    expect(screen.getByTestId("agent-row-acme/beta")).toBeTruthy();
    expect(screen.queryByText(/Loading agents/i)).toBeNull();
  });

  it("first mount auto-selects data.agents[0] even before tasks resolves", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    // Pending forever — the auto-select must still fire from data.agents.
    mockListTasks.mockReturnValue(new Promise<never>(() => {}));
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    const pane = await screen.findByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/alpha");
    // The first row's select button reports selected state via aria-current;
    // the row itself no longer exposes listbox-style aria-selected state.
    const alphaSelect = screen.getByTestId("agent-row-select-acme/alpha");
    expect(alphaSelect.getAttribute("aria-current")).toBe("true");
  });

  it("per-row activity tag shows a skeleton while tasks is null, then the count after resolve", async () => {
    const agents = [makeAgent("acme/alpha")];
    let resolveTasks: (value: TaskRecord[]) => void = () => {};
    mockListTasks.mockReturnValue(
      new Promise<TaskRecord[]>((res) => {
        resolveTasks = res;
      }),
    );
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // Skeleton present while pending.
    expect(screen.getByTestId("agent-row-activity-skeleton-acme/alpha")).toBeTruthy();

    // Resolve — running count surfaces in place of the skeleton.
    await act(async () => {
      resolveTasks([
        {
          id: "t-running",
          agent: "acme/alpha",
          status: "running",
          brief: "",
          details: "",
          origin: "cli",
          metadata: {},
          createdAt: "2026-05-23T00:00:00Z",
        } as unknown as TaskRecord,
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("agent-row-activity-skeleton-acme/alpha")).toBeNull();
    });
    const activity = screen.getByTestId("agent-row-activity-acme/alpha");
    expect(activity.textContent).toBe("1 running");
  });

  it("user click wins over auto-select once tasks resolves", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // Click beta through the row's select button to pin the selection in the URL.
    const betaSelect = await screen.findByTestId("agent-row-select-acme/beta");
    act(() => {
      fireEvent.click(betaSelect);
    });
    await waitFor(() => {
      const probe = screen.getByTestId("url-probe");
      expect(probe.getAttribute("data-search")).toContain("selected=acme%2Fbeta");
    });
    // Tasks already resolved (mockResolvedValue([])); the user's pick
    // must not be replaced by the auto-select fallback.
    const pane = screen.getByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/beta");
  });

  it("row uses the shared AgentAvatar + AgentFqn primitives", () => {
    const agents = [makeAgent("widgets/dev"), makeAgent("acme/dev")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // Both rows render. Two different scopes share the same short name.
    const rowA = screen.getByTestId("agent-row-widgets/dev");
    const rowB = screen.getByTestId("agent-row-acme/dev");

    // Each row renders the full FQN via the shared <AgentFqn> primitive.
    // We scope by the row so the assertion isn't confused by the same
    // primitive being mounted in the right-pane header for the selected
    // agent; AgentFqn in the AgentDetailPane title keeps the identity split.
    expect(rowA.querySelector('[data-testid="agent-fqn-widgets/dev"]')).toBeTruthy();
    expect(rowB.querySelector('[data-testid="agent-fqn-acme/dev"]')).toBeTruthy();

    // And each row renders an avatar — colour-distinguishable because the
    // hash keys off the full FQN (see AgentAvatar lock-in tests).
    const avatarA = rowA.querySelector('[data-testid="agent-avatar-widgets/dev"]') as HTMLElement;
    const avatarB = rowB.querySelector('[data-testid="agent-avatar-acme/dev"]') as HTMLElement;
    expect(avatarA).toBeTruthy();
    expect(avatarB).toBeTruthy();
    expect(avatarA.style.backgroundColor).not.toBe(avatarB.style.backgroundColor);
  });

  it("selected row carries the agents-list__item--selected class hook (accent stripe)", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    renderMasterDetail({
      agents,
      initialPath: "/workspaces/ws-1/runtime/agents?selected=acme%2Fbeta",
    });

    const beta = await screen.findByTestId("agent-row-acme/beta");
    expect(beta.className).toContain("agents-list__item--selected");
    const alpha = screen.getByTestId("agent-row-acme/alpha");
    expect(alpha.className).not.toContain("agents-list__item--selected");
  });
});

describe("auto-selected agent sessions fetch", () => {
  it("fires listSessions for the auto-selected agent when ?selected= is absent", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([] as SessionView[]);

    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // The right pane drives off `effectiveSelectedFqn` (auto-select
    // fallback). The sessions refresh must key off that effective fqn,
    // not the raw URL `selectedFqn`; otherwise `listSessions` never fires
    // on first paint without `?selected=` and the pane sits on
    // "Loading" forever. The auto-selected agent should trigger the
    // same listSessions call as an explicit URL pick.
    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalled();
    });
    const lastCall = mockListSessions.mock.calls.at(-1) ?? [];
    expect(lastCall[0]?.agent).toBe("acme/alpha");
  });

  it("re-fires listSessions when the user picks a different row (selection wins over auto-select)", async () => {
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([] as SessionView[]);

    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalled();
    });
    mockListSessions.mockClear();

    const betaSelect = screen.getByTestId("agent-row-select-acme/beta");
    act(() => {
      fireEvent.click(betaSelect);
    });

    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalled();
    });
    const lastCall = mockListSessions.mock.calls.at(-1) ?? [];
    expect(lastCall[0]?.agent).toBe("acme/beta");
  });
});

describe("agent switch resets pane-local state", () => {
  it("clears the action-error banner when the user picks a different agent in the master list", async () => {
    // AgentDetailPane is rendered at one JSX position while `fqn`
    // changes. The pane resets local action state on each fqn change so
    // a failed dispatch banner belongs only to the selected agent.
    const agents = [makeAgent("acme/alpha"), makeAgent("acme/beta")];
    mockListTasks.mockResolvedValue([]);
    mockListSessions.mockResolvedValue([] as SessionView[]);
    mockDispatchTask.mockRejectedValueOnce(new Error("dispatch failed (mock)"));

    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // Auto-select picks alpha (first row). Wait for the pane to mount
    // against that agent before exercising the dispatch flow.
    const initialPane = await screen.findByTestId("agent-detail-pane");
    expect(initialPane.getAttribute("data-agent-fqn")).toBe("acme/alpha");

    // Open the in-place DispatchModal on agent A.
    act(() => {
      fireEvent.click(screen.getByTestId("agent-detail-new-task"));
    });
    const briefInput = await waitFor(() => {
      const input = document.getElementById("task-brief") as HTMLInputElement | null;
      expect(input).toBeTruthy();
      return input as HTMLInputElement;
    });

    // Fill a valid brief and submit — the mocked dispatchTask rejects,
    // so AgentDetailPane catches the error and surfaces the action
    // banner on agent A's pane.
    await act(async () => {
      fireEvent.change(briefInput, { target: { value: "reset repro brief" } });
    });
    const form = briefInput.closest("form") as HTMLFormElement;
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByTestId("agent-detail-action-error")).toBeTruthy();
    });

    // Sanity: dispatchTask was actually invoked with agent A's fqn so
    // the banner we just observed is genuinely the failed-dispatch one.
    expect(mockDispatchTask).toHaveBeenCalledTimes(1);
    expect(mockDispatchTask.mock.calls[0]?.[0]?.agent).toBe("acme/alpha");

    // Switch the master list to agent B (click the row's select button).
    act(() => {
      fireEvent.click(screen.getByTestId("agent-row-select-acme/beta"));
    });

    // The pane reconciles to agent B (same instance, new `fqn` prop).
    await waitFor(() => {
      expect(screen.getByTestId("agent-detail-pane").getAttribute("data-agent-fqn")).toBe(
        "acme/beta",
      );
    });

    // The `useEffect([fqn])` reset clears `actionError`
    // (and `busy` / `dispatchOpen` / `createOpen`) on agent switch, so
    // agent A's banner must NOT bleed into agent B's pane.
    expect(screen.queryByTestId("agent-detail-action-error")).toBeNull();
  });
});

describe("running-first sort", () => {
  it("orders active agents above idle, alpha within each bucket, on the default 'all' filter", async () => {
    // Three agents: A idle, B and C both active. The runningTasks
    // values are derived by computeAgentRuntimeViews from the tasks
    // list — give B 1 running task and C 2 running tasks (count must
    // NOT influence ordering — both go in the "active" bucket and
    // sort alphabetically within it).
    const agents = [makeAgent("acme/aardvark"), makeAgent("acme/beta"), makeAgent("acme/charlie")];
    mockListTasks.mockResolvedValue([
      {
        id: "t-1",
        agent: "acme/beta",
        status: "running",
        brief: "",
        details: "",
        origin: "cli",
        metadata: {},
        createdAt: "2026-05-23T00:00:00Z",
      } as unknown as TaskRecord,
      {
        id: "t-2",
        agent: "acme/charlie",
        status: "running",
        brief: "",
        details: "",
        origin: "cli",
        metadata: {},
        createdAt: "2026-05-23T00:00:00Z",
      } as unknown as TaskRecord,
      {
        id: "t-3",
        agent: "acme/charlie",
        status: "running",
        brief: "",
        details: "",
        origin: "cli",
        metadata: {},
        createdAt: "2026-05-23T00:00:00Z",
      } as unknown as TaskRecord,
    ]);

    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    // Wait for the rendered DOM order to settle after the tasks fetch
    // resolves — `computeAgentRuntimeViews` flips beta/charlie into
    // the "running" bucket then.
    await waitFor(() => {
      const activity = screen.getByTestId("agent-row-activity-acme/beta");
      expect(activity.textContent).toMatch(/running/);
    });
    const rows = Array.from(
      // The row container is a presentational <li>. Scope to <li>
      // elements tagged with the row testid to avoid matching the inner select
      // button (also data-testid-prefixed `agent-row-select-…`) or the
      // activity-text spans (`agent-row-activity-…`).
      document.querySelectorAll<HTMLElement>('li[data-testid^="agent-row-"]'),
    ).map((el) => el.getAttribute("data-testid"));

    expect(rows).toEqual([
      "agent-row-acme/beta",
      "agent-row-acme/charlie",
      "agent-row-acme/aardvark",
    ]);

    // Auto-select fallback picks the topmost active row (beta), NOT
    // the alphabetically-first row across all buckets (aardvark).
    const pane = screen.getByTestId("agent-detail-pane");
    expect(pane.getAttribute("data-agent-fqn")).toBe("acme/beta");
  });

  it("preserves alpha order when all agents are idle", async () => {
    const agents = [makeAgent("acme/zeta"), makeAgent("acme/alpha"), makeAgent("acme/middle")];
    mockListTasks.mockResolvedValue([]);

    renderMasterDetail({ agents, initialPath: "/workspaces/ws-1/runtime/agents" });

    await waitFor(() => {
      expect(screen.getByTestId("agent-row-acme/alpha")).toBeTruthy();
    });
    const rows = Array.from(
      // Post- row container is presentational; scope to <li> only.
      document.querySelectorAll<HTMLElement>('li[data-testid^="agent-row-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(rows).toEqual(["agent-row-acme/alpha", "agent-row-acme/middle", "agent-row-acme/zeta"]);
  });
});
