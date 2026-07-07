import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowArtifact, WorkflowDag, WorkflowHeader, WorkflowNode } from "../../../src/api";

vi.mock("../../../src/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api")>("../../../src/api");
  return {
    ...actual,
    workflowArtifactUrl: (id: string, subPath: string) =>
      `/api/wf/${id}/${encodeURIComponent(subPath)}`,
  };
});

// Stub the markdown renderer so we don't fetch over the network when
// asserting the artifact card structure.
vi.mock("../../../src/components/tasks/TaskDetail/MarkdownSummary", () => ({
  MarkdownSummary: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));

import { ArtifactsTab } from "../../../src/pages/workflows/ArtifactsTab";

function makeWf(overrides: Partial<WorkflowHeader> = {}): WorkflowHeader {
  return {
    id: "wf-1",
    brief: "x",
    status: "succeeded",
    origin: "standalone",
    coordinatorAgent: "official/engineer",
    metadata: {},
    createdAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "n-default",
    workflowId: "wf-1",
    kind: "worker",
    status: "running",
    phase: 0,
    specVersion: 0,
    spec: { kind: "worker", agent: "official/engineer", brief: "x" },
    metadata: {},
    createdAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeDag(nodes: WorkflowNode[]): WorkflowDag {
  return {
    workflow: {
      id: "wf-1",
      brief: "x",
      status: "succeeded",
      origin: "standalone",
      coordinatorAgent: "official/engineer",
      metadata: {},
      createdAt: "2026-05-28T00:00:00.000Z",
    },
    nodes,
    edges: [],
  };
}

beforeEach(() => {
  // jsdom's `fetch` polyfill differs across versions — stub a 404 so
  // the preview pane lands in a deterministic state for tests that
  // don't care about the body bytes.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", { status: 404 }) as unknown as Response,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ArtifactsTab — empty + error states", () => {
  it("renders an empty state when the workflow has no artifacts", async () => {
    render(
      <ArtifactsTab workflow={makeWf()} dag={null} artifacts={[]} loaded={true} error={null} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-empty")).toBeTruthy();
    });
  });

  it("renders an error banner when the list fetch fails", async () => {
    render(
      <ArtifactsTab workflow={makeWf()} dag={null} artifacts={null} loaded={true} error="boom" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-error").textContent).toContain("boom");
    });
  });

  it("renders a loading placeholder while the parent's fetch is still in flight", async () => {
    render(
      <ArtifactsTab workflow={makeWf()} dag={null} artifacts={null} loaded={false} error={null} />,
    );
    expect(screen.getByTestId("workflow-artifacts-loading")).toBeTruthy();
  });
});

describe("ArtifactsTab — dropdown UX", () => {
  it("renders a <select> with `<optgroup>` per source (Workflow + per-node)", async () => {
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
      {
        kind: "node",
        nodeId: "n-a",
        relPath: "logs.txt",
        size: 200,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    const optgroups = select.querySelectorAll("optgroup");
    expect(optgroups.length).toBe(2);
    const labels = Array.from(optgroups).map((og) => og.getAttribute("label"));
    expect(labels[0]).toBe("Workflow");
    // Without a DAG we cannot resolve agent labels, so the per-node
    // group falls back to "Node <shortId>".
    expect(labels[1]).toMatch(/^Node n-a/);
  });

  it("trims trailing dashes from the 8-char short id in the node group label", async () => {
    // When a nodeId's 8-char window
    // lands on a `-` separator (e.g. `n-12345-extra` -> short
    // `n-12345-`), the dangling dash made the label read as
    // `Node n-12345-` with no visible character after it. Trim
    // trailing dashes off the short slice so the label always ends
    // on a glyph.
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "node",
        nodeId: "n-12345-extra-bytes-here",
        relPath: "logs.txt",
        size: 200,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    const optgroup = select.querySelector("optgroup");
    const label = optgroup?.getAttribute("label") ?? "";
    expect(label).toBe("Node n-12345");
    expect(label.endsWith("-")).toBe(false);
  });

  it("auto-selects the first artifact on mount and renders a download link to it", async () => {
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    expect(select.value).toBe("summary/report.md");
    const download = select.closest("header")?.querySelector("a.artifacts-pane__download");
    expect(download?.getAttribute("href")).toBe("/api/wf/wf-1/summary%2Freport.md");
    expect(download?.getAttribute("download")).toBe("report.md");
  });

  it("renders the preview pane container regardless of fetch outcome", async () => {
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-preview")).toBeTruthy();
    });
  });
});

describe("ArtifactsTab — node group label (agent · Phase + disambiguator)", () => {
  it("labels a node group as 'agent · Phase N' (1-indexed) when the DAG resolves it", async () => {
    // Wire phase 1 must surface as "Phase 2" in the dropdown — matches
    // the +1 convention used by the DAG view's phase labels and
    // WorkflowMetaStats' phase progress.
    const dag = makeDag([
      makeNode({
        id: "n-rev",
        phase: 1,
        spec: { kind: "worker", agent: "official/reviewer", brief: "r" },
      }),
    ]);
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "node",
        nodeId: "n-rev",
        relPath: "verdict.json",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={dag}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    const optgroup = select.querySelector("optgroup[label*='official/reviewer']");
    expect(optgroup?.getAttribute("label")).toBe("official/reviewer · Phase 2");
  });

  it("appends '· #N' when multiple nodes share the same (agent, phase) bucket", async () => {
    // Two reviewer nodes in the same wire phase (e.g. parallel
    // reviewer + designer spawned by one coord wake-up). The #N
    // disambiguator orders by createdAt ASC, mirroring
    // groupByPhase's sibling column convention.
    const dag = makeDag([
      makeNode({
        id: "n-rev-early",
        phase: 1,
        createdAt: "2026-05-28T00:01:00.000Z",
        spec: { kind: "worker", agent: "official/reviewer", brief: "first" },
      }),
      makeNode({
        id: "n-rev-late",
        phase: 1,
        createdAt: "2026-05-28T00:02:00.000Z",
        spec: { kind: "worker", agent: "official/reviewer", brief: "second" },
      }),
    ]);
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "node",
        nodeId: "n-rev-early",
        relPath: "verdict.json",
        size: 100,
        modifiedAt: "2026-05-28T00:01:00.000Z",
      },
      {
        kind: "node",
        nodeId: "n-rev-late",
        relPath: "verdict.json",
        size: 100,
        modifiedAt: "2026-05-28T00:02:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={dag}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    const labels = Array.from(select.querySelectorAll("optgroup")).map((og) =>
      og.getAttribute("label"),
    );
    // createdAt ASC ordering puts -early first (#1), then -late (#2).
    expect(labels).toEqual([
      "official/reviewer · Phase 2 · #1",
      "official/reviewer · Phase 2 · #2",
    ]);
  });

  it("does NOT append '· #N' when the bucket has only one node", async () => {
    // Defensive: single-node buckets stay clean as `agent · Phase N`,
    // so the dropdown doesn't read `· #1` for the common case.
    const dag = makeDag([
      makeNode({
        id: "n-only",
        phase: 0,
        spec: { kind: "worker", agent: "official/engineer", brief: "x" },
      }),
    ]);
    const artifacts: WorkflowArtifact[] = [
      {
        kind: "node",
        nodeId: "n-only",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={dag}
        artifacts={artifacts}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-artifacts-selector")).toBeTruthy();
    });
    const select = screen.getByTestId("workflow-artifacts-selector") as HTMLSelectElement;
    const optgroup = select.querySelector("optgroup[label*='official/engineer']");
    expect(optgroup?.getAttribute("label")).toBe("official/engineer · Phase 1");
    expect(optgroup?.getAttribute("label")?.includes("#")).toBe(false);
  });
});

describe("ArtifactsTab — bytes-fetch is keyed on (subPath + modifiedAt), not entry identity", () => {
  it("does NOT re-fetch the selected artifact's bytes when the artifact list re-polls with unchanged modifiedAt", async () => {
    // Repro of the over-aggressive refetch bug: the parent re-polls
    // the artifact list every WORKFLOW_POLL_INTERVAL_MS and hands us a
    // NEW array reference with structurally identical items. Before
    // the fix the bytes-fetch effect keyed on the derived
    // `selectedEntry` object (new reference each poll), so the iframe
    // / HTML viewer flashed every cycle. After the fix the effect
    // keys on `subPath + "|" + modifiedAt` (a string), so an
    // unchanged artifact is a no-op.
    const artifacts1: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];

    // Stub fetch with an OK response so the effect runs to completion
    // (covers the `if (!res.ok)` early-return branch from beforeEach).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("hello", { status: 200 }) as unknown as Response);

    const { rerender } = render(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts1}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/wf/wf-1/summary%2Freport.md");

    // Simulate a poll cycle: build a structurally-identical NEW array
    // (different reference) with the SAME modifiedAt for the selected
    // artifact. The effect must not re-fire.
    const artifacts2: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:00:00.000Z",
      },
    ];
    rerender(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts2}
        loaded={true}
        error={null}
      />,
    );

    // Give the microtask queue a beat to flush; fetch count MUST stay
    // at 1. (Asserting via a short poll loop rather than a fixed
    // timeout keeps the test resilient on slow CI.)
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Now bump the selected artifact's modifiedAt: the effect SHOULD
    // re-fire because the underlying bytes legitimately changed.
    const artifacts3: WorkflowArtifact[] = [
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 100,
        modifiedAt: "2026-05-28T00:01:00.000Z",
      },
    ];
    rerender(
      <ArtifactsTab
        workflow={makeWf()}
        dag={null}
        artifacts={artifacts3}
        loaded={true}
        error={null}
      />,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
