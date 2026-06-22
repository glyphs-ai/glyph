import { beforeEach, describe, expect, it } from "vitest";
import { cloneDeep } from "../../src/mocks/clone.js";
import { resetStore, store } from "../../src/mocks/store.js";

describe("mock store", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("seed", () => {
    it("seeds tasks from fixtures", () => {
      expect(store.tasks.length).toBeGreaterThan(0);
      expect(store.tasks[0]!.id).toBeDefined();
    });

    it("seeds sessions from fixtures", () => {
      expect(store.sessions.length).toBeGreaterThan(0);
      expect(store.sessions[0]!.id).toBeDefined();
    });

    it("seeds agents from fixtures", () => {
      expect(store.agents.length).toBeGreaterThan(0);
      expect(store.agents[0]!.agent.fqn).toBeDefined();
    });

    it("deep-clones so mutations do not corrupt original store state", () => {
      const originalBrief = store.tasks[0]!.brief;
      store.tasks[0]!.brief = "MUTATED";
      resetStore();
      expect(store.tasks[0]!.brief).toBe(originalBrief);
    });
  });

  describe("task mutations", () => {
    it("can add a task to the store", () => {
      const before = store.tasks.length;
      store.tasks.unshift({
        id: "20260622-aabbccdd",
        agent: "test/agent",
        brief: "Test task",
        origin: "standalone",
        status: "running",
        metadata: {},
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      });
      expect(store.tasks.length).toBe(before + 1);
      expect(store.tasks[0]!.id).toBe("20260622-aabbccdd");
    });

    it("can cancel a task in place", () => {
      const task = store.tasks.find((t) => t.status === "running");
      expect(task).toBeDefined();
      task!.status = "cancelled";
      task!.endedAt = new Date().toISOString();
      task!.cancellation = { kind: "user", message: "test" };
      expect(store.tasks.find((t) => t.id === task!.id)!.status).toBe("cancelled");
    });
  });

  describe("session mutations", () => {
    it("can add a session to the store", () => {
      const before = store.sessions.length;
      store.sessions.unshift({
        id: "sess-test1234",
        workdir: "/mock/test",
        agent: "test/agent",
        runtime: "copilot",
        runtimeSessionId: null,
        createdAt: new Date().toISOString(),
        lastActiveAt: null,
        preview: null,
        lastLaunchMode: null,
      });
      expect(store.sessions.length).toBe(before + 1);
    });
  });

  describe("catalog mutations", () => {
    it("can add and remove an agent", () => {
      const before = store.agents.length;
      store.agents.push({
        agent: {
          fqn: "test/new-agent",
          origin: "https://example.com/test/new-agent",
          description: "Test",
          version: "1.0.0",
          prereqsAck: true,
          disabledByUser: false,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        status: "ready",
        coordEligible: false,
      } as (typeof store.agents)[number]);
      expect(store.agents.length).toBe(before + 1);

      const idx = store.agents.findIndex((a) => a.agent.fqn === "test/new-agent");
      store.agents.splice(idx, 1);
      expect(store.agents.length).toBe(before);
    });

    it("can add and remove a skill", () => {
      store.skills.push({
        skill: {
          fqn: "test/new-skill",
          origin: "https://example.com/test/new-skill",
          description: "Test skill",
          version: "1.0.0",
          prereqsAck: true,
          orphaned: false,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        status: "ready",
      } as (typeof store.skills)[number]);
      expect(store.skills.length).toBe(1);

      store.skills.splice(0, 1);
      expect(store.skills.length).toBe(0);
    });

    it("can add and remove an mcp", () => {
      store.mcps.push({
        fqn: "test/new-mcp",
        origin: "https://example.com/test/new-mcp",
        orphaned: false,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as (typeof store.mcps)[number]);
      expect(store.mcps.length).toBe(1);

      store.mcps.splice(0, 1);
      expect(store.mcps.length).toBe(0);
    });
  });

  describe("resetStore", () => {
    it("restores original state after mutations", () => {
      const origTasks = store.tasks.length;
      const origSessions = store.sessions.length;
      const origAgents = store.agents.length;
      store.tasks.length = 0;
      store.sessions.length = 0;
      store.agents.length = 0;
      resetStore();
      expect(store.tasks.length).toBe(origTasks);
      expect(store.sessions.length).toBe(origSessions);
      expect(store.agents.length).toBe(origAgents);
    });
  });
});

describe("cloneDeep", () => {
  it("deep-clones nested objects", () => {
    const obj = { a: { b: [1, 2, 3] }, c: "hello" };
    const clone = cloneDeep(obj);
    expect(clone).toEqual(obj);
    clone.a.b.push(4);
    expect(obj.a.b.length).toBe(3);
  });

  it("handles null and primitives", () => {
    expect(cloneDeep(null)).toBe(null);
    expect(cloneDeep(42)).toBe(42);
    expect(cloneDeep("str")).toBe("str");
  });
});
