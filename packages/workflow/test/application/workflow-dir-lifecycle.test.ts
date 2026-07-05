/**
 * Per-workflow shared dir lifecycle across the create / finish / cancel / delete
 * use-cases.
 *
 * The substrate manages `<workspaceDir>/workflows/<workflowId>/` on behalf of
 * the coordinator: created (empty) on `createWorkflow`, preserved across
 * terminal status transitions for audit, and optionally torn down by
 * `deleteWorkflow({ purgeDir: true })`. The coord owns the internal layout; the
 * substrate only owns the wrapping directory's existence.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workflowDir } from "../../src/infrastructure/file/workflow-sandbox.js";
import {
  bootstrap,
  buildWorkflowFixture,
  fixedRandomBytes,
  fixedRandomUUID,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

describe("workflowDir lifecycle", () => {
  let f: WorkflowFixture;

  beforeEach(async () => {
    f = await buildWorkflowFixture({
      randomUUID: fixedRandomUUID(VALID_UUIDS),
      randomBytes: fixedRandomBytes(["aaaaaaaa", "bbbbbbbb", "cccccccc"]),
      initialNow: new Date("2026-06-07T00:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await f.close();
  });

  it("createWorkflow materialises <workspaceDir>/workflows/<workflowId>/ on disk", async () => {
    const { workflowId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);

    expect(existsSync(wfDir)).toBe(true);
    expect(statSync(wfDir).isDirectory()).toBe(true);
  });

  it("the created workflowDir is empty (coord owns the internal layout)", async () => {
    const { workflowId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    // No `decisions/`, `notes.md`, etc — the substrate creates only the
    // wrapping directory.
    expect(readdirSync(wfDir)).toEqual([]);
  });

  it("EEXIST on the leaf workflowDir surfaces as an unexpected mkdir failure", async () => {
    // The leaf `mkdir(wfDir, { recursive: false })` does not tolerate a
    // pre-existing dir; a leftover from a crashed prior run surfaces as EEXIST
    // (wrapped in WorkflowDirReservationFailed) rather than silently reusing
    // the dir, which would risk leaking stale files into the fresh workflow.
    const expectedWorkflowId = "20260607-aaaaaaaa";
    const wfDir = workflowDir(f.workspaceDir, expectedWorkflowId);
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(path.join(wfDir, "pre-existing.txt"), "leftover from a previous run");

    const r = await f.module.createWorkflow.execute({
      brief: "test workflow",
      coordinatorAgent: "coord-agent",
    });
    expect(r.isErr()).toBe(true);
    const error = r._unsafeUnwrapErr();
    expect(error.type).toBe("WorkflowDirReservationFailed");
    expect((error as { cause?: { code?: string } }).cause?.code).toBe("EEXIST");
    // Pre-existing file is preserved — the substrate erred before any tx ran,
    // so no rollback removal triggered.
    expect(existsSync(path.join(wfDir, "pre-existing.txt"))).toBe(true);
  });

  it("validate-time failure does not leave an orphan workflowDir on disk", async () => {
    // Force the coord runner's validate to throw BEFORE the mkdir runs. We
    // expect no dir to be materialised and no row to be persisted.
    f.coordRunner.validateShouldThrow = new Error("simulated validate failure");

    const r = await f.module.createWorkflow.execute({
      brief: "test workflow",
      coordinatorAgent: "coord-agent",
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().type).toBe("NodeSpecError");

    // workflowId would have been `20260607-aaaaaaaa` had create proceeded.
    const wfDir = workflowDir(f.workspaceDir, "20260607-aaaaaaaa");
    expect(existsSync(wfDir)).toBe(false);
  });

  it("tx-failure inside createWorkflow rolls back the workflowDir (no orphan)", async () => {
    // Force the repository's write tx to throw (simulating a unique-constraint
    // violation or any DB-level write failure). The use-case must remove the
    // freshly reserved workflowDir on the catch path so the next operator sees
    // a consistent fs/db state. The repository isn't exposed, so we fail the
    // underlying write tx instead.
    const spy = vi.spyOn(f.db, "transaction").mockImplementation(() => {
      throw new Error("simulated tx failure");
    });

    const r = await f.module.createWorkflow.execute({
      brief: "test workflow",
      coordinatorAgent: "coord-agent",
    });
    expect(r.isErr()).toBe(true);

    const wfDir = workflowDir(f.workspaceDir, "20260607-aaaaaaaa");
    expect(existsSync(wfDir)).toBe(false);

    spy.mockRestore();
  });

  it("workflow terminal status (succeeded) preserves the workflowDir for audit", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);

    // Materialise a sentinel inside the wfDir so we can prove nothing inside it
    // was touched by the status transition.
    await writeFile(path.join(wfDir, "sentinel.txt"), "audit-evidence");

    // Drive the initial coord to a terminal state, then finish the workflow as
    // `succeeded`.
    (
      await f.module.engine.markNodeTerminal(workflowId, initialCoordNodeId, {
        status: "succeeded",
      })
    )._unsafeUnwrap();
    (await f.module.finishWorkflow.execute({ workflowId, outcome: "succeeded" }))._unsafeUnwrap();

    const wf = (await f.module.getWorkflow.execute({ workflowId }))._unsafeUnwrap();
    expect(wf.status).toBe("succeeded");

    // Dir AND sentinel survive.
    expect(existsSync(wfDir)).toBe(true);
    expect(existsSync(path.join(wfDir, "sentinel.txt"))).toBe(true);
  });

  it("workflow terminal status (failed) preserves the workflowDir for audit", async () => {
    const { workflowId, initialCoordNodeId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    await writeFile(path.join(wfDir, "sentinel.txt"), "audit-evidence");

    (
      await f.module.engine.markNodeTerminal(workflowId, initialCoordNodeId, {
        status: "failed",
        reason: "boom",
      })
    )._unsafeUnwrap();
    (
      await f.module.finishWorkflow.execute({
        workflowId,
        outcome: "failed",
        failure: { kind: "coordinator", message: "boom" },
      })
    )._unsafeUnwrap();

    expect(existsSync(wfDir)).toBe(true);
    expect(existsSync(path.join(wfDir, "sentinel.txt"))).toBe(true);
  });

  it("workflow cancellation preserves the workflowDir for audit", async () => {
    const { workflowId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    await writeFile(path.join(wfDir, "sentinel.txt"), "audit-evidence");

    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "operator pressed cancel" },
      })
    )._unsafeUnwrap();

    expect(existsSync(wfDir)).toBe(true);
    expect(existsSync(path.join(wfDir, "sentinel.txt"))).toBe(true);
  });

  it("deleteWorkflow with purgeDir removes the workflowDir after terminal status", async () => {
    const { workflowId } = await bootstrap(f);
    const wfDir = workflowDir(f.workspaceDir, workflowId);
    await mkdir(path.join(wfDir, "decisions"), { recursive: true });
    await writeFile(path.join(wfDir, "decisions", "wake-1.md"), "first decision");

    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "stop" },
      })
    )._unsafeUnwrap();
    // Status flipped — but the dir still exists.
    expect(existsSync(wfDir)).toBe(true);

    (await f.module.deleteWorkflow.execute({ workflowId, purgeDir: true }))._unsafeUnwrap();
    expect(existsSync(wfDir)).toBe(false);
    expect((await f.module.getWorkflow.execute({ workflowId })).isErr()).toBe(true);
  });

  it("createWorkflow yields disjoint workflowDirs across two consecutive workflows", async () => {
    const { workflowId: wfa } = await bootstrap(f);
    const { workflowId: wfb } = await bootstrap(f);
    expect(wfa).not.toBe(wfb);

    const dirA = workflowDir(f.workspaceDir, wfa);
    const dirB = workflowDir(f.workspaceDir, wfb);
    expect(dirA).not.toBe(dirB);
    expect(existsSync(dirA)).toBe(true);
    expect(existsSync(dirB)).toBe(true);
  });
});
