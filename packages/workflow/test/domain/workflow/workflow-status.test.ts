import { describe, expect, it } from "vitest";
import { WorkflowStatusSchema } from "../../../src/domain/workflow/workflow-status.js";

const accepts = (x: unknown): boolean => WorkflowStatusSchema.safeParse(x).success;

describe("WorkflowStatusSchema", () => {
  it("accepts each valid value", () => {
    for (const s of ["running", "succeeded", "failed", "cancelled"]) {
      expect(accepts(s)).toBe(true);
    }
  });

  it("rejects an unknown value", () => {
    expect(accepts("archived")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(accepts("")).toBe(false);
  });
});
