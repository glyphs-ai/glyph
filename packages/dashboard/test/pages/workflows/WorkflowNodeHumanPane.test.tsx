import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowDagWire, WorkflowHeaderWire, WorkflowNodeWire } from "../../../src/api";
import { WorkflowNodeHumanPane } from "../../../src/pages/workflows/WorkflowNodeHumanPane";

function makeWf(overrides: Partial<WorkflowHeaderWire> = {}): WorkflowHeaderWire {
  return {
    id: "wf-1",
    brief: "test workflow",
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

function makeHumanNode(
  spec: WorkflowNodeWire["spec"],
  overrides: Partial<WorkflowNodeWire> = {},
): WorkflowNodeWire {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workflowId: "wf-1",
    phase: 0,
    status: "succeeded",
    spec,
    metadata: {},
    createdAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  } as WorkflowNodeWire;
}

function makeDag(node: WorkflowNodeWire): WorkflowDagWire {
  return {
    workflow: makeWf(),
    nodes: [node],
    edges: [],
  } as unknown as WorkflowDagWire;
}

afterEach(() => cleanup());

describe("WorkflowNodeHumanPane — promptStyle dispatch", () => {
  it("renders a plain prompt as a single <p> with the literal text", () => {
    const node = makeHumanNode({
      kind: "human",
      prompt: "**not bold** — plain",
      promptStyle: "plain",
    });
    render(
      <WorkflowNodeHumanPane
        workflow={makeWf()}
        dag={makeDag(node)}
        nodeId={node.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    const plain = screen.getByTestId("human-prompt-plain");
    expect(plain.tagName).toBe("P");
    expect(plain.textContent).toBe("**not bold** — plain");
    expect(screen.queryByTestId("human-prompt-markdown")).toBeNull();
  });

  it("renders a markdown prompt via MarkdownSummary (block elements)", () => {
    const node = makeHumanNode({
      kind: "human",
      prompt: ["## Heading", "", "- one", "- two"].join("\n"),
      promptStyle: "markdown",
    });
    render(
      <WorkflowNodeHumanPane
        workflow={makeWf()}
        dag={makeDag(node)}
        nodeId={node.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    const md = screen.getByTestId("human-prompt-markdown");
    expect(md.querySelector("h2")?.textContent).toBe("Heading");
    expect(md.querySelectorAll("ul li")).toHaveLength(2);
    expect(screen.queryByTestId("human-prompt-plain")).toBeNull();
  });

  it("falls back to plain rendering when promptStyle is absent (legacy in-flight nodes)", () => {
    // Pre-PromptStyle in-flight nodes stored before the schema landed
    // do not carry the field; the renderer must keep showing the
    // literal text so a coord-intended plain prompt does not start
    // italicising itself on the next dashboard load.
    const legacySpec = {
      kind: "human",
      prompt: "Pick version 1.0.*",
    } as unknown as WorkflowNodeWire["spec"];
    const node = makeHumanNode(legacySpec);
    render(
      <WorkflowNodeHumanPane
        workflow={makeWf()}
        dag={makeDag(node)}
        nodeId={node.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
    const plain = screen.getByTestId("human-prompt-plain");
    expect(plain.tagName).toBe("P");
    expect(plain.textContent).toBe("Pick version 1.0.*");
    expect(screen.queryByTestId("human-prompt-markdown")).toBeNull();
  });
});
