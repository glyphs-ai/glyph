import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDag, WorkflowHeader, WorkflowNode } from "../../../src/api";
import { OverviewTab } from "../../../src/pages/workflows/OverviewTab";

function makeWf(overrides: Partial<WorkflowHeader> = {}): WorkflowHeader {
  return {
    id: "wf-1",
    brief: "Default brief",
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

afterEach(() => cleanup());

describe("OverviewTab — Summary card", () => {
  it("renders success.output via Summary card for succeeded workflows", () => {
    render(
      <OverviewTab
        workflow={makeWf({
          status: "succeeded",
          success: { output: "## Done\nmigration applied" },
        })}
      />,
    );
    const summary = screen.getByTestId("workflow-overview-summary");
    expect(summary.textContent).toContain("Done");
    expect(summary.textContent).toContain("migration applied");
  });

  it("does NOT render the Summary card when success.output is empty / missing", () => {
    render(<OverviewTab workflow={makeWf({ status: "succeeded", success: { output: "" } })} />);
    expect(screen.queryByTestId("workflow-overview-summary")).toBeNull();
    expect(screen.getByTestId("workflow-overview-no-summary").textContent).toMatch(
      /no recorded summary/i,
    );
  });
});

describe("OverviewTab — Details card", () => {
  it("renders the details block when present", () => {
    render(<OverviewTab workflow={makeWf({ details: "step 1\nstep 2\nstep 3" })} />);
    expect(screen.getByTestId("workflow-overview-details").textContent).toContain("step 1");
  });

  it("omits the details block when details is empty / undefined", () => {
    // The brief itself is rendered by WorkflowView's title — OverviewTab
    // intentionally omits it to avoid the same string appearing twice.
    render(<OverviewTab workflow={makeWf()} />);
    expect(screen.queryByTestId("workflow-overview-details")).toBeNull();
  });
});

describe("OverviewTab — typed state strips", () => {
  it("renders a typed failure callout for status=failed with a failure payload", () => {
    render(
      <OverviewTab
        workflow={makeWf({
          status: "failed",
          failure: { kind: "coordinator", message: "coordinator returned non-zero" },
        })}
      />,
    );
    const callout = screen.getByTestId("workflow-overview-failure-callout");
    expect(callout.textContent).toContain("coordinator");
    expect(screen.getByTestId("workflow-overview-failure-message").textContent).toContain(
      "coordinator returned non-zero",
    );
  });

  it("renders a cancellation note for status=cancelled with a cancellation payload", () => {
    render(
      <OverviewTab
        workflow={makeWf({
          status: "cancelled",
          cancellation: { kind: "user", message: "no longer needed" },
        })}
      />,
    );
    expect(screen.getByTestId("workflow-overview-cancellation").textContent).toContain(
      "no longer needed",
    );
  });

  it("renders a missing-payload note for terminal rows with no typed payload", () => {
    render(<OverviewTab workflow={makeWf({ status: "failed" })} />);
    expect(screen.getByTestId("workflow-overview-missing-payload-note")).toBeTruthy();
  });

  it("succeeded-with-no-payload uses the same alert chrome as failed/cancelled missing-payload branches", () => {
    render(<OverviewTab workflow={makeWf({ status: "succeeded" })} />);
    const note = screen.getByTestId("workflow-overview-missing-payload-note");
    expect(note.className).toContain("alert");
    expect(note.className).toContain("alert--info");
    expect(note.className).toContain("overview-tab__strip");
    expect(note.tagName).toBe("DIV");
  });

  it("renders the running hint for in-flight workflows", () => {
    render(<OverviewTab workflow={makeWf({ status: "running" })} />);
    expect(screen.getByTestId("workflow-overview-running-hint")).toBeTruthy();
  });
});

describe("OverviewTab — awaiting CTA", () => {
  const humanNode: WorkflowNode = {
    id: "node-human-1",
    workflowId: "wf-1",
    phase: 1,
    status: "running",
    spec: { kind: "human", prompt: "Please confirm", promptStyle: "plain" },
    createdAt: "2026-05-28T00:01:00.000Z",
  } as unknown as WorkflowNode;

  const dag: WorkflowDag = {
    nodes: [
      humanNode,
      {
        id: "node-worker-1",
        workflowId: "wf-1",
        phase: 0,
        status: "succeeded",
        spec: { kind: "worker", agentRef: "official/engineer", brief: "do stuff" },
        createdAt: "2026-05-28T00:00:00.000Z",
      },
    ],
    edges: [],
  } as unknown as WorkflowDag;

  it("renders awaiting message when awaitingHumanCount === 1", () => {
    render(<OverviewTab workflow={makeWf({ awaitingHumanCount: 1 })} dag={dag} />);
    const hint = screen.getByTestId("workflow-overview-awaiting-hint");
    expect(hint.textContent).toContain("1 human node is waiting for your input.");
  });

  it("renders plural awaiting message when awaitingHumanCount > 1", () => {
    render(<OverviewTab workflow={makeWf({ awaitingHumanCount: 3 })} dag={dag} />);
    const hint = screen.getByTestId("workflow-overview-awaiting-hint");
    expect(hint.textContent).toContain("3 human nodes are waiting for your input.");
  });

  it("renders 'Open node →' button and fires callback on click", () => {
    const onGoToHumanNode = vi.fn();
    render(
      <OverviewTab
        workflow={makeWf({ awaitingHumanCount: 1 })}
        dag={dag}
        onGoToHumanNode={onGoToHumanNode}
      />,
    );
    const btn = screen.getByTestId("workflow-overview-go-to-node");
    expect(btn.textContent).toBe("Open node →");
    fireEvent.click(btn);
    expect(onGoToHumanNode).toHaveBeenCalledTimes(1);
    expect(onGoToHumanNode).toHaveBeenCalledWith(humanNode);
  });

  it("renders 'Open first node →' button label when count > 1", () => {
    render(
      <OverviewTab
        workflow={makeWf({ awaitingHumanCount: 2 })}
        dag={dag}
        onGoToHumanNode={vi.fn()}
      />,
    );
    expect(screen.getByTestId("workflow-overview-go-to-node").textContent).toBe(
      "Open first node →",
    );
  });

  it("renders the generic running hint when awaitingHumanCount is 0", () => {
    render(<OverviewTab workflow={makeWf({ awaitingHumanCount: 0 })} dag={dag} />);
    expect(screen.getByTestId("workflow-overview-running-hint")).toBeTruthy();
    expect(screen.queryByTestId("workflow-overview-awaiting-hint")).toBeNull();
  });
});
