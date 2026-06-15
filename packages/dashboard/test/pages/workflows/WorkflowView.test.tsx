import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDagWire, WorkflowHeaderWire } from "../../../src/api";

vi.mock("../../../src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api")>("../../../src/api");
  return {
    ...actual,
    listWorkflowArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
    workflowArtifactUrl: (id: string, sub: string) => `/${id}/${sub}`,
  };
});

import * as api from "../../../src/api";
import { WorkflowView } from "../../../src/pages/workflows/WorkflowView";

const mockListWorkflowArtifacts = api.listWorkflowArtifacts as unknown as ReturnType<typeof vi.fn>;

function makeWf(overrides: Partial<WorkflowHeaderWire> = {}): WorkflowHeaderWire {
  return {
    id: "wf-1",
    brief: "Default",
    status: "running",
    coordinatorAgent: "official/engineer",
    metadata: {},
    awaitingHumanCount: 0,
    createdAt: "2026-05-28T00:00:00.000Z",
    iterationCount: 0,
    ...overrides,
  };
}

function makeDag(wf: WorkflowHeaderWire): WorkflowDagWire {
  return {
    workflow: wf,
    nodes: [
      {
        id: "n1",
        workflowId: wf.id,
        status: "running",
        phase: 0,
        spec: { kind: "worker", agent: "official/engineer", brief: "x" },
        metadata: {},
        createdAt: wf.createdAt,
        taskId: "task-1",
      },
    ],
    edges: [],
  };
}

afterEach(() => cleanup());

describe("WorkflowView — tablist", () => {
  it("renders the three tabs and the overview tab is active on mount", () => {
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    expect(screen.getByTestId("workflow-tab-overview").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("workflow-tab-graph").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("workflow-tab-artifacts").getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByTestId("workflow-tabpanel-overview")).toBeTruthy();
  });

  it("swaps the active panel when a tab is clicked", () => {
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("workflow-tab-graph"));
    expect(screen.getByTestId("workflow-tab-graph").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("workflow-tabpanel-graph")).toBeTruthy();
  });

  it("ArrowRight / ArrowLeft cycles through tabs (WAI-ARIA tablist)", () => {
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    const overviewTab = screen.getByTestId("workflow-tab-overview");
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });
    expect(screen.getByTestId("workflow-tab-graph").getAttribute("aria-selected")).toBe("true");

    const graphTab = screen.getByTestId("workflow-tab-graph");
    fireEvent.keyDown(graphTab, { key: "ArrowRight" });
    expect(screen.getByTestId("workflow-tab-artifacts").getAttribute("aria-selected")).toBe("true");

    const artifactsTab = screen.getByTestId("workflow-tab-artifacts");
    fireEvent.keyDown(artifactsTab, { key: "ArrowLeft" });
    expect(screen.getByTestId("workflow-tab-graph").getAttribute("aria-selected")).toBe("true");
  });

  it("Home / End jump to first / last tab", () => {
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    const overviewTab = screen.getByTestId("workflow-tab-overview");
    fireEvent.keyDown(overviewTab, { key: "End" });
    expect(screen.getByTestId("workflow-tab-artifacts").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByTestId("workflow-tab-artifacts"), { key: "Home" });
    expect(screen.getByTestId("workflow-tab-overview").getAttribute("aria-selected")).toBe("true");
  });
});

describe("WorkflowView  detail-page action surface", () => {
  it("does NOT render the detail-page Cancel CTA for running workflows", () => {
    // Regression guard: row `` menu owns Cancel; the detail pane is no
    // longer an action surface for it. A future regression
    // that wires a Cancel button back onto the detail page would split
    // the action affordance and confuse users.
    render(
      <WorkflowView
        workflow={makeWf({ status: "running" })}
        dag={null}
        dagError={null}
        onSelectNode={() => {}}
      />,
    );
    expect(screen.queryByTestId("workflow-detail-cancel")).toBeNull();
  });

  it("does NOT render the detail-page Cancel CTA for terminal workflows either", () => {
    render(
      <WorkflowView
        workflow={makeWf({ status: "succeeded" })}
        dag={null}
        dagError={null}
        onSelectNode={() => {}}
      />,
    );
    expect(screen.queryByTestId("workflow-detail-cancel")).toBeNull();
  });
});

describe("WorkflowView — Artifacts tab badge", () => {
  it("renders the bare 'Artifacts' label when no artifacts have surfaced yet", async () => {
    // Empty-list default — the tab label stays clean (no `(0)` chip),
    // matching the Task variant's convention.
    mockListWorkflowArtifacts.mockResolvedValueOnce({ artifacts: [] });
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    // Wait for the hook to resolve so the loaded state is settled.
    await waitFor(() => {
      // Empty fetch resolves; label still reads "Artifacts" (no count).
      expect(screen.getByTestId("workflow-tab-artifacts").textContent).toBe("Artifacts");
    });
  });

  it("renders 'Artifacts (N)' once the parent's hook surfaces a non-zero count", async () => {
    mockListWorkflowArtifacts.mockResolvedValueOnce({
      artifacts: [
        {
          kind: "workflow-summary",
          path: "summary.html",
          size: 100,
          modifiedAt: "2026-05-28T00:00:00.000Z",
          mimeBucket: "html",
        },
        {
          kind: "node",
          nodeId: "n1",
          taskId: "task-1",
          path: "log.txt",
          size: 200,
          modifiedAt: "2026-05-28T00:00:00.000Z",
          mimeBucket: "text",
        },
      ],
    });
    const wf = makeWf();
    render(
      <WorkflowView workflow={wf} dag={makeDag(wf)} dagError={null} onSelectNode={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-tab-artifacts").textContent).toBe("Artifacts (2)");
    });
  });
});
