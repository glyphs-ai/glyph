import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HumanSpecPatchSchema,
  UpdateWorkflowNodeSpecRequestSchema,
  WorkerSpecPatchSchema,
} from "../../src/application/update-workflow-node-spec.js";
import {
  addIteration,
  bootstrap,
  buildWorkflowFixture,
  fixedRandomUUID,
  MISSING_WORKFLOW_ID,
  setNodeLifecycle,
  VALID_UUIDS,
  type WorkflowFixture,
} from "./workflow-fixture.js";

/** Bootstrap a workflow + add one not_started worker `w1` and a human `h1`. */
async function seed(f: WorkflowFixture) {
  const { workflowId, initialCoordNodeId } = await bootstrap(f);
  const { nodeIds, coordId } = await addIteration(f, {
    workflowId,
    parentCoordId: initialCoordNodeId,
    nodes: [
      { tempId: "w1", kind: "worker", spec: { agent: "w", brief: "original" } },
      { tempId: "h1", kind: "human", spec: { prompt: "approve?", promptStyle: "plain" } },
    ],
    coordSpec: { agent: "coord-next" },
  });
  return {
    workflowId,
    initialCoordNodeId,
    workerId: nodeIds.w1!,
    humanId: nodeIds.h1!,
    trailingCoordId: coordId,
  };
}

describe("WorkflowModule.updateNodeSpec — happy paths", () => {
  let f: WorkflowFixture;
  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });
  afterEach(async () => {
    await f.close();
  });

  it("new nodes start at specVersion 0", async () => {
    const { workflowId, workerId } = await seed(f);
    const node = (await f.module.getNode.execute({ workflowId, nodeId: workerId }))._unsafeUnwrap();
    expect(node.specVersion).toBe(0);
  });

  it("patches a worker brief, preserving other keys and bumping specVersion", async () => {
    const { workflowId, workerId } = await seed(f);

    const { node: res, newSpecVersion } = (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: workerId,
        expectedSpecVersion: 0,
        target: { kind: "worker", patch: { brief: "revised brief" } },
      })
    )._unsafeUnwrap();

    // Shallow merge keeps `agent`, overwrites `brief`.
    expect(res.spec).toEqual({ agent: "w", brief: "revised brief" });
    expect(res.specVersion).toBe(1);
    expect(newSpecVersion).toBe(1);
    expect(res.kind).toBe("worker");

    // The runner sees the MERGED spec, not just the patch.
    expect(f.workerRunner.validateCalls.at(-1)?.spec).toEqual({
      agent: "w",
      brief: "revised brief",
    });

    // Persisted through save(): a fresh read reflects the new spec + version.
    const reread = (
      await f.module.getNode.execute({ workflowId, nodeId: workerId })
    )._unsafeUnwrap();
    expect(reread.spec).toEqual({ agent: "w", brief: "revised brief" });
    expect(reread.specVersion).toBe(1);
  });

  it("patches multiple worker fields at once", async () => {
    const { workflowId, workerId } = await seed(f);
    const { node: res } = (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: workerId,
        expectedSpecVersion: 0,
        target: { kind: "worker", patch: { agent: "w2", brief: "b2", details: "d", runtime: "r" } },
      })
    )._unsafeUnwrap();
    expect(res.spec).toEqual({ agent: "w2", brief: "b2", details: "d", runtime: "r" });
  });

  it("patches a human prompt, preserving promptStyle", async () => {
    const { workflowId, humanId } = await seed(f);
    const { node: res, newSpecVersion } = (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: humanId,
        expectedSpecVersion: 0,
        target: { kind: "human", patch: { prompt: "really approve?" } },
      })
    )._unsafeUnwrap();
    expect(res.spec).toEqual({ prompt: "really approve?", promptStyle: "plain" });
    expect(res.specVersion).toBe(1);
    expect(newSpecVersion).toBe(1);
    expect(res.kind).toBe("human");
  });

  it("persists the runner-normalized spec, not the raw merge", async () => {
    const { workflowId, workerId } = await seed(f);
    // Simulate a runner that drops unknown keys / normalizes.
    f.workerRunner.validateReturnValue = { agent: "w", brief: "normalized" };
    const { node: res } = (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: workerId,
        expectedSpecVersion: 0,
        target: { kind: "worker", patch: { brief: "raw" } },
      })
    )._unsafeUnwrap();
    expect(res.spec).toEqual({ agent: "w", brief: "normalized" });
  });
});

describe("WorkflowModule.updateNodeSpec — optimistic concurrency", () => {
  let f: WorkflowFixture;
  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });
  afterEach(async () => {
    await f.close();
  });

  it("rejects a stale specVersion with SpecVersionConflict {expected, actual}", async () => {
    const { workflowId, workerId } = await seed(f);
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 3,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "SpecVersionConflict",
      nodeId: workerId,
      expected: 3,
      actual: 0,
    });
  });

  it("a second patch at the now-stale version conflicts; the current version succeeds", async () => {
    const { workflowId, workerId } = await seed(f);
    // 0 → 1
    (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: workerId,
        expectedSpecVersion: 0,
        target: { kind: "worker", patch: { brief: "first" } },
      })
    )._unsafeUnwrap();

    // Replaying version 0 now conflicts.
    const stale = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "second" } },
    });
    expect(stale._unsafeUnwrapErr()).toMatchObject({
      type: "SpecVersionConflict",
      expected: 0,
      actual: 1,
    });

    // Using the current version (1) succeeds and bumps to 2.
    const { node: ok, newSpecVersion } = (
      await f.module.updateNodeSpec.execute({
        workflowId,
        nodeId: workerId,
        expectedSpecVersion: 1,
        target: { kind: "worker", patch: { brief: "second" } },
      })
    )._unsafeUnwrap();
    expect(ok.specVersion).toBe(2);
    expect(newSpecVersion).toBe(2);
    expect(ok.spec).toEqual({ agent: "w", brief: "second" });
  });
});

describe("WorkflowModule.updateNodeSpec — guard rejections", () => {
  let f: WorkflowFixture;
  beforeEach(async () => {
    f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
  });
  afterEach(async () => {
    await f.close();
  });

  it("rejects a coordinator target with CoordSpecNotEditable (worker body)", async () => {
    const { workflowId, trailingCoordId } = await seed(f);
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: trailingCoordId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "CoordSpecNotEditable",
      nodeId: trailingCoordId,
    });
  });

  it("rejects a coordinator target regardless of body kind (human body)", async () => {
    const { workflowId, trailingCoordId } = await seed(f);
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: trailingCoordId,
      expectedSpecVersion: 0,
      target: { kind: "human", patch: { prompt: "x" } },
    });
    expect(r._unsafeUnwrapErr().type).toBe("CoordSpecNotEditable");
  });

  it("rejects a kind mismatch with NodeKindMismatch {expected, actual}", async () => {
    const { workflowId, workerId } = await seed(f);
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "human", patch: { prompt: "x" } },
    });
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "NodeKindMismatch",
      nodeId: workerId,
      expected: "human",
      actual: "worker",
    });
  });

  it("rejects a started node with WorkflowNodeNotMutable (verb updateNodeSpec)", async () => {
    const { workflowId, workerId } = await seed(f);
    setNodeLifecycle(f, {
      id: workerId,
      status: "running",
      runningAt: "2026-06-07T01:00:00.000Z",
    });
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowNodeNotMutable",
      nodeId: workerId,
      status: "running",
      verb: "updateNodeSpec",
    });
  });

  it("surfaces a runner validation failure as NodeSpecError", async () => {
    const { workflowId, workerId } = await seed(f);
    f.workerRunner.validateShouldThrow = new Error("agent not in coord menu");
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "NodeSpecError",
      nodeKind: "worker",
      reason: "agent not in coord menu",
    });
  });

  it("does not persist a change when validation fails", async () => {
    const { workflowId, workerId } = await seed(f);
    f.workerRunner.validateShouldThrow = new Error("bad");
    await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    const node = (await f.module.getNode.execute({ workflowId, nodeId: workerId }))._unsafeUnwrap();
    expect(node.spec).toEqual({ agent: "w", brief: "original" });
    expect(node.specVersion).toBe(0);
  });

  it("rejects when the workflow does not exist", async () => {
    const r = await f.module.updateNodeSpec.execute({
      workflowId: MISSING_WORKFLOW_ID,
      nodeId: VALID_UUIDS[0]!,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowNotFound");
  });

  it("rejects an unknown node with WorkflowNodeNotFound", async () => {
    const { workflowId } = await seed(f);
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: VALID_UUIDS[15]!,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowNodeNotFound",
      nodeId: VALID_UUIDS[15]!,
    });
  });

  it("rejects on a terminal workflow with WorkflowAlreadyTerminal (ahead of node checks)", async () => {
    const { workflowId, workerId } = await seed(f);
    (
      await f.module.cancelWorkflow.execute({
        workflowId,
        cancellation: { kind: "user", message: "" },
      })
    )._unsafeUnwrap();
    const r = await f.module.updateNodeSpec.execute({
      workflowId,
      nodeId: workerId,
      expectedSpecVersion: 0,
      target: { kind: "worker", patch: { brief: "x" } },
    });
    expect(r._unsafeUnwrapErr().type).toBe("WorkflowAlreadyTerminal");
  });
});

describe("update-workflow-node-spec request/patch schemas", () => {
  it("worker patch: rejects empty and unknown keys, accepts a single field", () => {
    expect(WorkerSpecPatchSchema.safeParse({}).success).toBe(false);
    expect(WorkerSpecPatchSchema.safeParse({ unknown: 1 }).success).toBe(false);
    expect(WorkerSpecPatchSchema.safeParse({ prompt: "x" }).success).toBe(false); // human key
    expect(WorkerSpecPatchSchema.safeParse({ brief: "ok" }).success).toBe(true);
  });

  it("worker patch: rejects a multiline or over-long brief at the boundary", () => {
    expect(WorkerSpecPatchSchema.safeParse({ brief: "line1\nline2" }).success).toBe(false);
    expect(WorkerSpecPatchSchema.safeParse({ brief: "x".repeat(201) }).success).toBe(false);
    expect(WorkerSpecPatchSchema.safeParse({ brief: "   " }).success).toBe(false);
  });

  it("human patch: rejects empty, bad promptStyle, and too many choices", () => {
    expect(HumanSpecPatchSchema.safeParse({}).success).toBe(false);
    expect(HumanSpecPatchSchema.safeParse({ promptStyle: "bogus" }).success).toBe(false);
    expect(
      HumanSpecPatchSchema.safeParse({
        choices: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, label: `l${i}` })),
      }).success,
    ).toBe(false);
    expect(HumanSpecPatchSchema.safeParse({ prompt: "ok" }).success).toBe(true);
  });

  it("request schema: has no coordinator arm in the target union", () => {
    const parsed = UpdateWorkflowNodeSpecRequestSchema.safeParse({
      workflowId: "20260607-abcdef01",
      nodeId: VALID_UUIDS[0]!,
      expectedSpecVersion: 0,
      target: { kind: "coordinator", patch: { agent: "x" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("execute throws synchronously on an empty patch (zod parse)", async () => {
    const f = await buildWorkflowFixture({ randomUUID: fixedRandomUUID(VALID_UUIDS) });
    try {
      const { workflowId, workerId } = await seed(f);
      expect(() =>
        f.module.updateNodeSpec.execute({
          workflowId,
          nodeId: workerId,
          expectedSpecVersion: 0,
          target: { kind: "worker", patch: {} },
        }),
      ).toThrow();
    } finally {
      await f.close();
    }
  });
});
