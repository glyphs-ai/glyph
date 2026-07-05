import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../../src/api";
import type { AgentEntry } from "../../../src/api/catalog.js";
import { agentDetailUrl, computeAgentRuntimeViews } from "../../../src/pages/Runtime/agent-runtime";

function makeAgent(fqn: string): AgentEntry {
  return {
    agent: { fqn, scope: fqn.split("/")[0], short: fqn.split("/")[1], version: "0.0.0" },
  } as unknown as AgentEntry;
}

function makeTask(agent: string, status: TaskRecord["status"]): TaskRecord {
  return {
    id: `t-${Math.random()}`,
    agent,
    status,
    brief: "",
    details: "",
    origin: "cli",
    metadata: {},
    createdAt: "2026-05-23T00:00:00Z",
  } as unknown as TaskRecord;
}

describe("computeAgentRuntimeViews", () => {
  it("classifies agents with at least one running task as 'running'", () => {
    const agents = [makeAgent("official/engineer"), makeAgent("acme/qa")];
    const tasks = [
      makeTask("official/engineer", "running"),
      makeTask("official/engineer", "succeeded"),
      makeTask("acme/qa", "succeeded"),
    ];
    const views = computeAgentRuntimeViews(agents, tasks);
    const dev = views.find((v) => v.entry.agent.fqn === "official/engineer")!;
    const qa = views.find((v) => v.entry.agent.fqn === "acme/qa")!;
    expect(dev.status).toBe("running");
    expect(dev.runningTasks).toBe(1);
    expect(dev.totalTasks7d).toBe(2);
    expect(qa.status).toBe("idle");
    expect(qa.runningTasks).toBe(0);
    expect(qa.totalTasks7d).toBe(1);
  });

  it("returns idle with zero counts for an agent with no tasks", () => {
    const views = computeAgentRuntimeViews([makeAgent("a/b")], []);
    expect(views).toHaveLength(1);
    expect(views[0].status).toBe("idle");
    expect(views[0].runningTasks).toBe(0);
    expect(views[0].totalTasks7d).toBe(0);
  });

  it("ignores tasks whose agent isn't in the catalog list", () => {
    const views = computeAgentRuntimeViews(
      [makeAgent("a/b")],
      [makeTask("ghost/agent", "running")],
    );
    expect(views).toHaveLength(1);
    expect(views[0].status).toBe("idle");
  });
});

describe("agentDetailUrl", () => {
  it("emits the master-detail ?selected= shape", () => {
    expect(agentDetailUrl("ws-1", "official", "engineer")).toBe(
      "/workspaces/ws-1/runtime/agents?selected=official%2Fengineer",
    );
  });
  it("encodes special characters in workspaceId and in the scope/short fqn payload", () => {
    expect(agentDetailUrl("ws 1", "a b", "c d")).toBe(
      "/workspaces/ws%201/runtime/agents?selected=a%20b%2Fc%20d",
    );
  });
});
