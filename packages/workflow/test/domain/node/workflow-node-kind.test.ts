import { describe, expect, it } from "vitest";
import { WorkflowNodeKindSchema } from "../../../src/domain/node/workflow-node-kind.js";

// NOTE: the old `assertValidWorkflowNodeKind` distinguished a "shape" error
// (empty / non-string) from a "corruption" error (unknown string). That
// distinction now lives in the drizzle mapper's node rehydration
// (WorkflowNodeKindShape vs WorkflowNodeKindCorruption atoms); the closed-enum
// schema here only answers membership, so both cases surface as a failed parse.
const accepts = (x: unknown): boolean => WorkflowNodeKindSchema.safeParse(x).success;

describe("WorkflowNodeKindSchema (closed enum: 'coordinator' | 'worker' | 'human')", () => {
  it("accepts the three WorkflowNodeKind values", () => {
    expect(accepts("worker")).toBe(true);
    expect(accepts("coordinator")).toBe(true);
    expect(accepts("human")).toBe(true);
  });

  it("rejects values outside the closed WorkflowNodeKind enum", () => {
    for (const bad of ["task", "evaluator", "unknown-kind-99", "Worker", "WORKER", "Human"]) {
      expect(accepts(bad), `expected reject: ${bad}`).toBe(false);
    }
  });

  it("rejects the empty string", () => {
    expect(accepts("")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    for (const bad of [123, {}, null, undefined, []]) {
      expect(accepts(bad)).toBe(false);
    }
  });
});
