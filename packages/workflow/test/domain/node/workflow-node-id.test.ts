import { describe, expect, it } from "vitest";
import {
  generateWorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../../../src/domain/node/workflow-node-id.js";

const UUID_V4_LOWER = "550e8400-e29b-41d4-a716-446655440000";
const UUID_V4_UPPER = "550E8400-E29B-41D4-A716-446655440000";
const WORKFLOW_ID_LOWER = "20260522-aaaaaaaa";
const WORKFLOW_ID_UPPER = "20260522-AAAAAAAA";

const accepts = (x: unknown): boolean => WorkflowNodeIdSchema.safeParse(x).success;

describe("WorkflowNodeIdSchema", () => {
  it("accepts a lowercase UUIDv4", () => {
    expect(accepts(UUID_V4_LOWER)).toBe(true);
  });

  it("accepts an UPPERCASE UUIDv4", () => {
    expect(accepts(UUID_V4_UPPER)).toBe(true);
  });

  it("REJECTS the workflow <date>-<8hex> shape (node ids are UUIDv4 only)", () => {
    expect(accepts(WORKFLOW_ID_LOWER)).toBe(false);
    expect(accepts(WORKFLOW_ID_UPPER)).toBe(false);
  });

  it("rejects garbage strings", () => {
    for (const bad of ["", "foo", "550e8400-e29b-31d4-a716-446655440000"]) {
      expect(accepts(bad)).toBe(false);
    }
  });

  it("rejects non-string inputs", () => {
    for (const bad of [123, {}, null, undefined]) {
      expect(accepts(bad)).toBe(false);
    }
  });
});

describe("generateWorkflowNodeId", () => {
  it("generateWorkflowNodeId() returns a value that passes WorkflowNodeIdSchema", () => {
    for (let i = 0; i < 10; i++) {
      expect(accepts(generateWorkflowNodeId())).toBe(true);
    }
  });

  it("generateWorkflowNodeId() honors the injected RNG seam", () => {
    const id = generateWorkflowNodeId(() => UUID_V4_LOWER);
    expect(id).toBe(UUID_V4_LOWER);
    expect(accepts(id)).toBe(true);
  });
});
