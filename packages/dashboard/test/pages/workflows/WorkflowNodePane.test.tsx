import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDag, WorkflowHeader } from "../../../src/api";

vi.mock("../../../src/hooks/useTaskDetail", () => ({
  useTaskDetail: () => ({
    task: null,
    activity: null,
    activityError: null,
    refresh: vi.fn(),
    loadOlder: vi.fn(),
  }),
}));

// The pane resolves a node id to its latest task via `findTaskByOrigin`
// before mounting the TaskView. Stub it so the nav pill (rendered in every
// resolution state) is present synchronously without a real fetch.
vi.mock("../../../src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api")>("../../../src/api");
  return {
    ...actual,
    findTaskByOrigin: vi.fn(async (_origin: string, originId: string) => ({
      id: `task-${originId}`,
    })),
  };
});

import { WorkflowNodePane } from "../../../src/pages/workflows/WorkflowNodePane";

function makeWf(overrides: Partial<WorkflowHeader> = {}): WorkflowHeader {
  return {
    id: "wf-1",
    brief: "test workflow",
    status: "running",
    origin: "standalone",
    coordinatorAgent: "official/engineer",
    metadata: {},
    createdAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeDag(): WorkflowDag {
  return {
    workflow: makeWf(),
    nodes: [
      {
        id: "n1",
        workflowId: "wf-1",
        kind: "worker" as const,
        status: "succeeded",
        phase: 0,
        spec: { kind: "worker", agent: "official/engineer", brief: "a" },
        metadata: {},
        createdAt: "2026-05-28T00:00:00.000Z",
        specVersion: 0,
      },
      {
        id: "n2",
        workflowId: "wf-1",
        kind: "worker" as const,
        status: "running",
        phase: 1,
        spec: { kind: "worker", agent: "official/engineer", brief: "b" },
        metadata: {},
        createdAt: "2026-05-28T00:01:00.000Z",
        specVersion: 0,
      },
      {
        id: "n3",
        workflowId: "wf-1",
        kind: "worker" as const,
        status: "running",
        phase: 2,
        spec: { kind: "worker", agent: "official/engineer", brief: "c" },
        metadata: {},
        createdAt: "2026-05-28T00:02:00.000Z",
        specVersion: 0,
      },
    ],
    edges: [],
  };
}

afterEach(() => cleanup());

describe("WorkflowNodePane", () => {
  it("renders the nav pill with N/M position counter", () => {
    render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n2"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("workflow-node-position").textContent).toBe("2 / 3");
  });

  it("surfaces the current node's specVersion readonly in the nav pill", () => {
    render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n2"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("workflow-node-spec-version").textContent).toBe("spec v0");
  });

  it("fires onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n2"
        pollIntervalMs={4000}
        onBack={onBack}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("workflow-node-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onNavigate with the previous node's id on prev click", () => {
    const onNavigate = vi.fn();
    render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n2"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("workflow-node-prev"));
    expect(onNavigate).toHaveBeenCalledWith("n1");
  });

  it("disables prev at the first node and next at the last node", () => {
    const { rerender } = render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n1"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect((screen.getByTestId("workflow-node-prev") as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n3"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect((screen.getByTestId("workflow-node-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a 'Node not found' fallback when the nodeId is not in the dag", () => {
    render(
      <WorkflowNodePane
        workflow={makeWf()}
        dag={makeDag()}
        nodeId="n-unknown"
        pollIntervalMs={4000}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("workflow-node-not-found")).toBeTruthy();
  });
});
