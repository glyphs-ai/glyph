import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowHeader } from "../src/api";
import type { AgentEntry } from "../src/api/catalog.js";

/**
 * Layer A (drill router) lock-in for the Workflows page. Verifies that
 * `pickDrillTarget` + `<WorkflowDrillPane>` route the URL drill slots to the
 * matching node pane: `?nodeTaskId=` → `<WorkflowNodeTaskPane>`, `?humanNodeId=`
 * → `<WorkflowNodeHumanPane>`, and `nodeTask` wins when both are populated.
 *
 * Kept in a sibling file (not `workflows-states.test.tsx`) so the Layer A
 * routing concern stays isolated from the Layer B list × detail state matrix —
 * the same separation the refactor introduces in the page itself.
 *
 * The DAG fetch is rejected (not left pending) so the header read still
 * settles `useWorkflowDetail` — it awaits `Promise.allSettled([header, dag])`,
 * so a pending dag would also stall the header. With the dag absent each pane
 * renders via its `dag === null` loading branch, which still carries the
 * pane's canonical testid. That keeps these routing assertions free of the
 * node-task pane's downstream TaskView / `useTaskDetail` machinery — routing
 * is all that's under test here.
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
    brief: "Drill workflow",
    status: "succeeded",
    origin: "standalone",
    coordinatorAgent: "official/engineer",
    metadata: {},
    createdAt: "2026-05-28T00:00:00.000Z",
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
  // A single selectable, header-resolved workflow so the drill gate
  // (`effectiveSelectedId !== null && detailWorkflow != null`) is satisfied.
  mockListWorkflows.mockResolvedValue([makeWorkflow({ id: "wf-1" })]);
  mockGetWorkflow.mockResolvedValue(makeWorkflow({ id: "wf-1" }));
  // Reject (rather than park) the DAG read so `useWorkflowDetail`'s
  // `Promise.allSettled([header, dag])` settles and the header lands; the
  // null dag keeps each pane on its `dag === null` loading branch.
  mockGetWorkflowDag.mockRejectedValue(new Error("dag unavailable"));
});

afterEach(() => cleanup());

describe("Workflows page — Layer A drill router", () => {
  it("?nodeTaskId routes the right pane to the node-task pane", async () => {
    renderWorkflows(`${PATH}?range=all&workflowId=wf-1&nodeTaskId=task-1`, agents);
    expect(await screen.findByTestId("workflow-node-pane")).toBeTruthy();
    expect(screen.queryByTestId("workflow-human-pane")).toBeNull();
    expect(screen.queryByTestId("workflow-human-not-found")).toBeNull();
  });

  it("?humanNodeId routes the right pane to the human pane", async () => {
    renderWorkflows(`${PATH}?range=all&workflowId=wf-1&humanNodeId=hn-1`, agents);
    expect(await screen.findByTestId("workflow-human-pane")).toBeTruthy();
    expect(screen.queryByTestId("workflow-node-pane")).toBeNull();
    expect(screen.queryByTestId("workflow-node-not-found")).toBeNull();
  });

  it("prefers the node-task pane when both drill slots are present", async () => {
    renderWorkflows(`${PATH}?range=all&workflowId=wf-1&nodeTaskId=task-1&humanNodeId=hn-1`, agents);
    expect(await screen.findByTestId("workflow-node-pane")).toBeTruthy();
    expect(screen.queryByTestId("workflow-human-pane")).toBeNull();
    expect(screen.queryByTestId("workflow-human-not-found")).toBeNull();
  });
});
