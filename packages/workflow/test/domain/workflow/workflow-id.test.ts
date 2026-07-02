import { describe, expect, it } from "vitest";
import { generateWorkflowId, WorkflowIdSchema } from "../../../src/domain/workflow/workflow-id.js";

// Sample UUIDv4 ids: identical bytes, one lowercase and one uppercase.
const UUID_V4_LOWER = "550e8400-e29b-41d4-a716-446655440000";
const UUID_V4_UPPER = "550E8400-E29B-41D4-A716-446655440000";

// Workflow `<YYYYMMDD>-<8 hex>` shape. Lowercase only; the regex has no
// `/i` flag, so the uppercase variant must be rejected.
const WORKFLOW_ID_LOWER = "20260522-aaaaaaaa";
const WORKFLOW_ID_UPPER = "20260522-AAAAAAAA";

const accepts = (x: unknown): boolean => WorkflowIdSchema.safeParse(x).success;

describe("WorkflowIdSchema", () => {
  it("accepts the <YYYYMMDD>-<8 lowercase hex> shape", () => {
    expect(accepts(WORKFLOW_ID_LOWER)).toBe(true);
  });

  it("REJECTS UUIDv4 workflow ids", () => {
    expect(accepts(UUID_V4_LOWER)).toBe(false);
    expect(accepts(UUID_V4_UPPER)).toBe(false);
  });

  it("REJECTS uppercase workflow id hex (regex has no /i)", () => {
    expect(accepts(WORKFLOW_ID_UPPER)).toBe(false);
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
      expect(accepts(bad), `expected reject: ${bad}`).toBe(false);
    }
  });

  it("rejects non-string inputs", () => {
    for (const bad of [123, { id: UUID_V4_LOWER }, null, undefined, [], true]) {
      expect(accepts(bad)).toBe(false);
    }
  });
});

describe("generateWorkflowId", () => {
  it("generateWorkflowId() returns a value that passes WorkflowIdSchema", () => {
    for (let i = 0; i < 10; i++) {
      expect(accepts(generateWorkflowId())).toBe(true);
    }
  });

  it("generateWorkflowId() emits the `<YYYYMMDD>-<8hex>` shape", () => {
    // The generator mirrors `@glyphs-ai/task`'s `generateTaskId` — UTC date
    // prefix + 4 random bytes hex-encoded.
    expect(generateWorkflowId()).toMatch(/^\d{8}-[0-9a-f]{8}$/);
  });

  it("generateWorkflowId() honors the injected now + randomBytes seams", () => {
    const now = () => new Date("2026-05-22T10:11:12.000Z");
    const randomBytes = (n: number) => Buffer.alloc(n, 0xab);
    const id = generateWorkflowId(now, randomBytes);
    expect(id).toBe("20260522-abababab");
    expect(accepts(id)).toBe(true);
  });
});
