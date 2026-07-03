import { describe, expect, it } from "vitest";
import { countAwaitingHuman } from "../../src/routes/_workflow-projection.js";

describe("countAwaitingHuman", () => {
  it("returns 0 for an empty node list", () => {
    expect(countAwaitingHuman([])).toBe(0);
  });

  it("returns 0 when no human-kind nodes are running", () => {
    const nodes = [
      { kind: "coordinator", status: "running" },
      { kind: "worker", status: "running" },
      { kind: "human", status: "not_started" },
    ];
    expect(countAwaitingHuman(nodes)).toBe(0);
  });

  it("returns 1 for a single human-running node", () => {
    const nodes = [
      { kind: "coordinator", status: "succeeded" },
      { kind: "human", status: "running" },
    ];
    expect(countAwaitingHuman(nodes)).toBe(1);
  });

  it("returns 2 for two parallel human-running nodes", () => {
    const nodes = [
      { kind: "coordinator", status: "succeeded" },
      { kind: "human", status: "running" },
      { kind: "human", status: "running" },
    ];
    expect(countAwaitingHuman(nodes)).toBe(2);
  });

  it("counts only human-running in a mixed set", () => {
    const nodes = [
      { kind: "coordinator", status: "succeeded" },
      { kind: "human", status: "running" },
      { kind: "worker", status: "running" },
      { kind: "human", status: "succeeded" },
    ];
    expect(countAwaitingHuman(nodes)).toBe(1);
  });
});
