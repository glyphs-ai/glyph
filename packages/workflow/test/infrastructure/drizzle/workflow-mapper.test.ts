import { describe, expect, it } from "vitest";
import { WorkflowMapper } from "../../../src/infrastructure/drizzle/workflow-mapper.js";
import type { WorkflowRow } from "../../../src/infrastructure/drizzle/workflow-schema.js";

/**
 * Terminal-payload rehydration invariants. In the CQRS layout the row↔entity
 * mapping (and its corruption validation) is owned by `WorkflowMapper`, so these
 * cases drive `WorkflowMapper.toEntity` (returns a Result instead of throwing)
 * and `WorkflowMapper.toWorkflowRow` for the serialize direction.
 */

const NOW = "2026-06-07T00:00:00.000Z";
const WF_ID = "20260607-aaaaaaaa";

function rowBase(over?: Partial<WorkflowRow>): WorkflowRow {
  return {
    id: WF_ID,
    brief: "b",
    details: null,
    coordinatorAgent: "agent-1",
    status: "running",
    origin: "standalone",
    originId: null,
    metadata: "{}",
    createdAt: NOW,
    startedAt: NOW,
    endedAt: null,
    success: null,
    failure: null,
    cancellation: null,
    ...over,
  };
}

function toEntity(row: WorkflowRow) {
  return WorkflowMapper.toEntity({ workflowRow: row, nodeRows: [], edgeRows: [] });
}

describe("WorkflowMapper — terminal payload columns", () => {
  describe("succeeded", () => {
    it("round-trips success.output", () => {
      const e = toEntity(
        rowBase({
          status: "succeeded",
          endedAt: NOW,
          success: JSON.stringify({ output: "All sub-runs green." }),
        }),
      )._unsafeUnwrap();
      expect(e.success).toEqual({ output: "All sub-runs green." });
      expect(e.failure).toBeUndefined();
      expect(e.cancellation).toBeUndefined();
      const row = WorkflowMapper.toWorkflowRow(e);
      expect(row.success).toBe(JSON.stringify({ output: "All sub-runs green." }));
      expect(row.failure).toBeNull();
      expect(row.cancellation).toBeNull();
    });

    it("rejects null success column on terminal status", () => {
      expect(toEntity(rowBase({ status: "succeeded", endedAt: NOW })).isErr()).toBe(true);
    });

    it("rejects succeeded + failure column non-null (cross-field invariant)", () => {
      expect(
        toEntity(
          rowBase({
            status: "succeeded",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "coordinator", message: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });
  });

  describe("failed", () => {
    it("round-trips failure.kind + message", () => {
      const e = toEntity(
        rowBase({
          status: "failed",
          endedAt: NOW,
          failure: JSON.stringify({ kind: "coordinator", message: "budget out" }),
        }),
      )._unsafeUnwrap();
      expect(e.failure).toEqual({ kind: "coordinator", message: "budget out" });
      expect(e.success).toBeUndefined();
    });

    it("rejects null failure column on terminal status", () => {
      expect(toEntity(rowBase({ status: "failed", endedAt: NOW })).isErr()).toBe(true);
    });

    it("rejects failed + cancellation column non-null", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            cancellation: JSON.stringify({ kind: "user", message: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("rejects failure JSON with unknown kind", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "bogus", message: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("round-trips substrate failure.kind + reason + message", () => {
      const e = toEntity(
        rowBase({
          status: "failed",
          endedAt: NOW,
          failure: JSON.stringify({
            kind: "substrate",
            reason: "STUCK_RETRY_LIMIT",
            message: "cap tripped",
          }),
        }),
      )._unsafeUnwrap();
      expect(e.failure).toEqual({
        kind: "substrate",
        reason: "STUCK_RETRY_LIMIT",
        message: "cap tripped",
      });
    });

    it("rejects substrate failure JSON with unknown reason", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "substrate", reason: "BOGUS_REASON", message: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("rejects substrate failure JSON missing the reason field", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "substrate", message: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("rejects failure.kind 'coord'", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "coord", message: "invalid" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("rejects failure.kind 'internal'", () => {
      expect(
        toEntity(
          rowBase({
            status: "failed",
            endedAt: NOW,
            failure: JSON.stringify({ kind: "internal", message: "engine" }),
          }),
        ).isErr(),
      ).toBe(true);
    });
  });

  describe("cancelled", () => {
    it("round-trips cancellation.kind + message", () => {
      const e = toEntity(
        rowBase({
          status: "cancelled",
          endedAt: NOW,
          cancellation: JSON.stringify({ kind: "user", message: "stop" }),
        }),
      )._unsafeUnwrap();
      expect(e.cancellation).toEqual({ kind: "user", message: "stop" });
    });

    it("rejects null cancellation column on terminal status", () => {
      expect(toEntity(rowBase({ status: "cancelled", endedAt: NOW })).isErr()).toBe(true);
    });

    it("rejects cancelled + success column non-null", () => {
      expect(
        toEntity(
          rowBase({
            status: "cancelled",
            endedAt: NOW,
            success: JSON.stringify({ output: "x" }),
          }),
        ).isErr(),
      ).toBe(true);
    });

    it("rejects cancellation.kind 'cascade'", () => {
      expect(
        toEntity(
          rowBase({
            status: "cancelled",
            endedAt: NOW,
            cancellation: JSON.stringify({ kind: "cascade", message: "parent gone" }),
          }),
        ).isErr(),
      ).toBe(true);
    });
  });

  describe("running", () => {
    it("rejects any payload column on a non-terminal row", () => {
      expect(toEntity(rowBase({ success: JSON.stringify({ output: "x" }) })).isErr()).toBe(true);
      expect(
        toEntity(
          rowBase({ failure: JSON.stringify({ kind: "coordinator", message: "x" }) }),
        ).isErr(),
      ).toBe(true);
      expect(
        toEntity(rowBase({ cancellation: JSON.stringify({ kind: "user", message: "x" }) })).isErr(),
      ).toBe(true);
    });
  });
});
