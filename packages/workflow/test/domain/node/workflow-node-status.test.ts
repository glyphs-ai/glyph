import { describe, expect, it } from "vitest";
import { WorkflowNodeStatusSchema } from "../../../src/domain/node/workflow-node-status.js";

const accepts = (x: unknown): boolean => WorkflowNodeStatusSchema.safeParse(x).success;

describe("WorkflowNodeStatusSchema", () => {
  it("accepts each valid value", () => {
    for (const s of ["not_started", "ready", "running", "succeeded", "failed", "cancelled"]) {
      expect(accepts(s)).toBe(true);
    }
  });

  it("rejects an unknown value", () => {
    expect(accepts("paused")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(accepts("")).toBe(false);
  });
});
