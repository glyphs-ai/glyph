/**
 * Runtime tests for the pure validators in `src/validate.ts`.
 *
 * Covers the id-grammar contract (`<date>-<8hex>` for workflow ids,
 * UUIDv4 for node ids, lowercase-only) and the closed-enum
 * shape checks. Pure functions, no I/O, no fixtures — same shape
 * as `schema.test.ts` but at the validator layer.
 */

import { describe, expect, it } from "vitest";
import {
  InvalidWorkflowIdError,
  InvalidWorkflowNodeIdError,
  WorkflowEnumValueCorruptionError,
  WorkflowNodeKindCorruptionError,
  WorkflowNodeKindShapeError,
} from "../src/errors.js";
import {
  assertValidWorkflowId,
  assertValidWorkflowNodeId,
  assertValidWorkflowNodeKind,
  assertValidWorkflowNodeStatusEnum,
  assertValidWorkflowStatusEnum,
  generateWorkflowId,
  generateWorkflowNodeId,
} from "../src/validate.js";

// Sample UUIDv4 ids: identical bytes, one lowercase and one uppercase.
const UUID_V4_LOWER = "550e8400-e29b-41d4-a716-446655440000";
const UUID_V4_UPPER = "550E8400-E29B-41D4-A716-446655440000";

// Workflow `<YYYYMMDD>-<8 hex>` shape. Lowercase only; the regex has no
// `/i` flag, so the uppercase variant must be rejected.
const WORKFLOW_ID_LOWER = "20260522-aaaaaaaa";
const WORKFLOW_ID_UPPER = "20260522-AAAAAAAA";

describe("assertValidWorkflowId", () => {
  it("accepts the <YYYYMMDD>-<8 lowercase hex> shape", () => {
    expect(() => assertValidWorkflowId(WORKFLOW_ID_LOWER)).not.toThrow();
  });

  it("REJECTS UUIDv4 workflow ids", () => {
    expect(() => assertValidWorkflowId(UUID_V4_LOWER)).toThrowError(InvalidWorkflowIdError);
    expect(() => assertValidWorkflowId(UUID_V4_UPPER)).toThrowError(InvalidWorkflowIdError);
  });

  it("REJECTS uppercase workflow id hex (regex has no /i)", () => {
    expect(() => assertValidWorkflowId(WORKFLOW_ID_UPPER)).toThrowError(InvalidWorkflowIdError);
  });

  it("rejects garbage strings", () => {
    for (const bad of [
      "",
      "foo",
      "no-dashes-here",
      "550e8400e29b41d4a716446655440000", // missing dashes
      "550e8400-e29b-31d4-a716-446655440000", // wrong version (3 instead of 4)
      "550e8400-e29b-41d4-c716-446655440000", // bad variant nibble (c not 8/9/a/b)
      "20260522-zzzzzzzz", // non-hex in workflow id shape
      "2026052-aaaaaaaa", // 7-digit date in workflow id shape
    ]) {
      expect(() => assertValidWorkflowId(bad), `expected reject: ${bad}`).toThrowError(
        InvalidWorkflowIdError,
      );
    }
  });

  it("rejects non-string inputs", () => {
    for (const bad of [123, { id: UUID_V4_LOWER }, null, undefined, [], true]) {
      expect(() => assertValidWorkflowId(bad)).toThrowError(InvalidWorkflowIdError);
    }
  });
});

describe("assertValidWorkflowNodeId", () => {
  it("accepts a lowercase UUIDv4", () => {
    expect(() => assertValidWorkflowNodeId(UUID_V4_LOWER)).not.toThrow();
  });

  it("accepts an UPPERCASE UUIDv4", () => {
    expect(() => assertValidWorkflowNodeId(UUID_V4_UPPER)).not.toThrow();
  });

  it("REJECTS the workflow <date>-<8hex> shape (node ids are UUIDv4 only)", () => {
    expect(() => assertValidWorkflowNodeId(WORKFLOW_ID_LOWER)).toThrowError(
      InvalidWorkflowNodeIdError,
    );
    expect(() => assertValidWorkflowNodeId(WORKFLOW_ID_UPPER)).toThrowError(
      InvalidWorkflowNodeIdError,
    );
  });

  it("rejects garbage strings", () => {
    for (const bad of ["", "foo", "550e8400-e29b-31d4-a716-446655440000"]) {
      expect(() => assertValidWorkflowNodeId(bad)).toThrowError(InvalidWorkflowNodeIdError);
    }
  });

  it("rejects non-string inputs", () => {
    for (const bad of [123, {}, null, undefined]) {
      expect(() => assertValidWorkflowNodeId(bad)).toThrowError(InvalidWorkflowNodeIdError);
    }
  });
});

describe("generateWorkflowId / generateWorkflowNodeId round-trips", () => {
  it("generateWorkflowId() returns a string that passes assertValidWorkflowId", () => {
    for (let i = 0; i < 10; i++) {
      const id = generateWorkflowId();
      expect(() => assertValidWorkflowId(id)).not.toThrow();
    }
  });

  it("generateWorkflowId() emits the `<YYYYMMDD>-<8hex>` shape", () => {
    // The generator mirrors `@glyphs-ai/task`'s `generateTaskId` —
    // UTC date prefix + 4 random bytes hex-encoded.
    const id = generateWorkflowId();
    expect(id).toMatch(/^\d{8}-[0-9a-f]{8}$/);
  });

  it("generateWorkflowNodeId() returns a string that passes assertValidWorkflowNodeId", () => {
    for (let i = 0; i < 10; i++) {
      const id = generateWorkflowNodeId();
      expect(() => assertValidWorkflowNodeId(id)).not.toThrow();
    }
  });

  it("generateWorkflowId() honors the injected now + randomBytes seams", () => {
    const now = () => new Date("2026-05-22T10:11:12.000Z");
    const randomBytes = (n: number) => Buffer.alloc(n, 0xab);
    const id = generateWorkflowId(now, randomBytes);
    expect(id).toBe("20260522-abababab");
    expect(() => assertValidWorkflowId(id)).not.toThrow();
  });

  it("generateWorkflowNodeId() honors the injected RNG seam", () => {
    const id = generateWorkflowNodeId(() => UUID_V4_LOWER);
    expect(id).toBe(UUID_V4_LOWER);
    expect(() => assertValidWorkflowNodeId(id)).not.toThrow();
  });
});

describe("assertValidWorkflowStatusEnum", () => {
  it("accepts each valid value", () => {
    for (const s of ["running", "succeeded", "failed", "cancelled"]) {
      expect(() => assertValidWorkflowStatusEnum(s)).not.toThrow();
    }
  });

  it("rejects an unknown value", () => {
    expect(() => assertValidWorkflowStatusEnum("archived")).toThrowError(
      WorkflowEnumValueCorruptionError,
    );
  });

  it("rejects the empty string", () => {
    expect(() => assertValidWorkflowStatusEnum("")).toThrowError(WorkflowEnumValueCorruptionError);
  });
});

describe("assertValidWorkflowNodeStatusEnum", () => {
  it("accepts each valid value", () => {
    for (const s of ["not_started", "ready", "running", "succeeded", "failed", "cancelled"]) {
      expect(() => assertValidWorkflowNodeStatusEnum(s)).not.toThrow();
    }
  });

  it("rejects an unknown value", () => {
    expect(() => assertValidWorkflowNodeStatusEnum("paused")).toThrowError(
      WorkflowEnumValueCorruptionError,
    );
  });

  it("rejects the empty string", () => {
    expect(() => assertValidWorkflowNodeStatusEnum("")).toThrowError(
      WorkflowEnumValueCorruptionError,
    );
  });
});

describe("assertValidWorkflowNodeKind (closed enum: 'coordinator' | 'worker')", () => {
  it("accepts the two WorkflowNodeKind values", () => {
    expect(() => assertValidWorkflowNodeKind("worker")).not.toThrow();
    expect(() => assertValidWorkflowNodeKind("coordinator")).not.toThrow();
  });

  it("rejects values outside the closed WorkflowNodeKind enum", () => {
    // The substrate's `WorkflowNodeKind` is `'coordinator' | 'worker'`. Any
    // other persisted string value signals schema corruption.
    for (const bad of ["task", "evaluator", "unknown-kind-99", "Worker", "WORKER", "human"]) {
      expect(() => assertValidWorkflowNodeKind(bad), `expected reject: ${bad}`).toThrowError(
        WorkflowNodeKindCorruptionError,
      );
    }
  });

  it("rejects the empty string with WorkflowNodeKindShapeError (not WorkflowEnumValueCorruptionError)", () => {
    expect(() => assertValidWorkflowNodeKind("")).toThrowError(WorkflowNodeKindShapeError);
  });

  it("rejects non-string inputs with WorkflowNodeKindShapeError", () => {
    for (const bad of [123, {}, null, undefined, []]) {
      expect(() => assertValidWorkflowNodeKind(bad)).toThrowError(WorkflowNodeKindShapeError);
    }
  });
});
