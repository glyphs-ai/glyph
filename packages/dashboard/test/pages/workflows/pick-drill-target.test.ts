import { describe, expect, it } from "vitest";
import { pickDrillTarget } from "../../../src/pages/workflows/drill";

/**
 * Unit lock-in for the Layer A drill router. `pickDrillTarget` is a pure
 * data table mapping the two URL slots to the active drill discriminant;
 * these four cases pin the full input space (node-only, human-only,
 * both-set precedence, neither-set).
 */
describe("pickDrillTarget", () => {
  it("routes to the node drill when only nodeId is set", () => {
    expect(pickDrillTarget("task-1", null)).toEqual({ kind: "node", nodeId: "task-1" });
  });

  it("routes to the human drill when only humanNodeId is set", () => {
    expect(pickDrillTarget(null, "node-1")).toEqual({ kind: "human", humanNodeId: "node-1" });
  });

  it("prefers the node drill when both slots are populated", () => {
    expect(pickDrillTarget("task-1", "node-1")).toEqual({ kind: "node", nodeId: "task-1" });
  });

  it("returns null when neither slot is set", () => {
    expect(pickDrillTarget(null, null)).toBeNull();
  });
});
