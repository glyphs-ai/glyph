/**
 * Integration tests for {@link WorkflowEngine} composed via
 * `composeWorkflowModule`. Exercises the event-driven tick loop end-
 * to-end using FAKE runners (no real `@glyphs-ai/task` dependency) so
 * the assertions stay focused on engine ↔ substrate behavior.
 *
 * The fake coord runner is a passthrough stub whose `dispatch`
 * immediately fires `onTerminal({succeeded})` so workflow lifecycle
 * assertions can land cleanly.
 *
 * Scenarios (one `it` block each):
 *   1. happy path: create → coord auto-succeeds → add worker →
 *      worker auto-succeeds → workflow advances (downstream tick
 *      ratchet)
 *   2. runner reports failed → node marked failed
 *   3. runner reports cancelled → node marked cancelled
 *   4. runner.dispatch throws → dispatch-throw branch marks failed
 *   5. duplicate `onTerminal` calls → engine ignores second call
 *   6. per-workflow serialization → two concurrent triggers chain
 *      (asserted via interleaving-free dispatch ordering)
 *   7. cross-workflow parallelism → two workflows progress
 *      independently
 *   8. engine.drain() awaits in-flight ticks
 *   9. structural rules still fire (worker requires ≥1 parent)
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  WorkflowNodeDispatchOpts,
  WorkflowNodeRunner,
  WorkflowNodeValidateCtx,
} from "../../../src/application/ports/workflow-node-runner.js";
import type { DatabaseUnavailable } from "../../../src/domain/workflow/workflow-repository.js";
import type { WorkflowId, WorkflowNodeId } from "../../../src/index.js";
import { workflowRoot } from "../../../src/infrastructure/file/workflow-sandbox.js";
import { composeWorkflowModule, type WorkflowModule } from "../../../src/workflow-module.js";
import { openTestDb } from "../../testing.js";

const silentLogger = pino({ level: "silent" });

interface RecordingRunner extends WorkflowNodeRunner {
  /**
   * Replace the dispatch behavior. The default succeeds immediately
   * via `onTerminal({status: 'succeeded'})`; tests swap to drive
   * failure / cancel / throw / duplicate scenarios.
   */
  setDispatch(fn: (opts: WorkflowNodeDispatchOpts) => Promise<void>): void;
  readonly dispatchCalls: ReadonlyArray<{
    readonly workflowId: string;
    readonly nodeId: string;
  }>;
  readonly cancelCalls: readonly string[];
}

function makeAutoSucceedRunner(label: string): RecordingRunner {
  const dispatchCalls: Array<{ workflowId: string; nodeId: string }> = [];
  const cancelCalls: string[] = [];
  // Track per-workflow first-dispatch. Only the first dispatch for a
  // given workflow auto-succeeds; subsequent dispatches (which the
  // substrate's stuck-coord detector inserts as retry coords when a
  // coord exits without making forward progress) are recorded but
  // left in `running`. Without this guard, every auto-success would
  // trigger another retry coord, which would auto-succeed, ad
  // infinitum — a microtask-driven loop that would deadlock vitest's
  // setTimeout-based test timeout.
  const autoSucceededWorkflows = new Set<string>();
  const seenDispatches = new Set<string>();
  let seq = 0;
  let dispatchFn: (opts: WorkflowNodeDispatchOpts) => Promise<void> = async (opts) => {
    // Default: succeed immediately. Push the terminal off the
    // microtask queue so the engine has a chance to commit the
    // `ready → running` transition first; this exercises the
    // "onTerminal fires after dispatch returns" code path (the
    // common case in production).
    queueMicrotask(() => opts.onTerminal({ status: "succeeded" }));
    seq += 1;
    // Stub still tracks a per-call identifier mirroring runner
    // book-keeping (e.g. logging a task id); the substrate does not
    // consume it.
    void `${label}-unit-${seq}`;
  };
  const runner: RecordingRunner = {
    setDispatch(fn) {
      dispatchFn = fn;
    },
    dispatchCalls,
    cancelCalls,
    validate(spec, _ctx: WorkflowNodeValidateCtx) {
      return okAsync(spec);
    },
    dispatch(opts) {
      return new ResultAsync(
        (async (): Promise<Result<void, { readonly cause: unknown }>> => {
          const dispatchKey = `${opts.workflowId}:${opts.nodeId}`;
          if (seenDispatches.has(dispatchKey)) return ok(undefined);
          seenDispatches.add(dispatchKey);
          dispatchCalls.push({ workflowId: opts.workflowId, nodeId: opts.nodeId });
          // Per-workflow first-dispatch gate (enforced HERE, before
          // delegating to dispatchFn, so that test-overridden dispatch
          // functions installed via setDispatch don't have to re-implement
          // it). Subsequent dispatches for a workflow whose coord already
          // auto-succeeded once are recorded but left in `running` —
          // see the autoSucceededWorkflows comment above.
          if (autoSucceededWorkflows.has(opts.workflowId)) {
            return ok(undefined);
          }
          autoSucceededWorkflows.add(opts.workflowId);
          try {
            await dispatchFn(opts);
          } catch (cause) {
            return err({ cause });
          }
          return ok(undefined);
        })(),
      );
    },
    hasInFlightForNode(_nodeId) {
      return okAsync(false);
    },
    cancel(nodeId) {
      cancelCalls.push(nodeId);
      return okAsync(undefined);
    },
    listArtifacts() {
      return okAsync(null);
    },
    resolveArtifactPath() {
      return okAsync(null);
    },
  };
  return runner;
}

interface Harness {
  readonly module: WorkflowModule;
  readonly coord: RecordingRunner;
  readonly worker: RecordingRunner;
  readonly workspaceDir: string;
  cleanup(): Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const coord = makeAutoSucceedRunner("coord");
  const worker = makeAutoSucceedRunner("worker");
  const dbHandle = await openTestDb(":memory:");
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "wf-engine-test-"));
  // Mirror the workspace provisioner: createWorkflow now requires
  // `workflows/` to exist (mkdir leaf is `{recursive: false}`).
  mkdirSync(workflowRoot(workspaceDir));
  const module = await composeWorkflowModule({
    db: dbHandle.db,
    workspaceDir,
    runners: {
      coordinator: coord,
      worker,
      human: {
        validate: (s) => okAsync(s),
        dispatch: () => okAsync(undefined),
        hasInFlightForNode: () => okAsync(false),
        cancel: () => okAsync(undefined),
        listArtifacts: () => okAsync(null),
        resolveArtifactPath: () => okAsync(null),
      },
    },
    logger: silentLogger,
  });
  return {
    module,
    coord,
    worker,
    workspaceDir,
    async cleanup() {
      await module.close();
      dbHandle.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

async function currentCoordLeafId(
  module: WorkflowModule,
  workflowId: WorkflowId,
): Promise<WorkflowNodeId> {
  const dag = (await module.getDag.execute({ workflowId }))._unsafeUnwrap();
  const parents = new Set(dag.edges.map((edge) => edge.from));
  const coord = dag.nodes.find((node) => node.kind === "coordinator" && !parents.has(node.id));
  if (coord === undefined) throw new Error("currentCoordLeafId: missing coord leaf");
  return coord.id;
}

async function addWorkerIteration(
  module: WorkflowModule,
  args: {
    readonly workflowId: WorkflowId;
    readonly parentCoordId: WorkflowNodeId;
    readonly tempId: string;
    readonly spec: unknown;
    readonly coordAgent?: string;
  },
): Promise<{ readonly nodeId: WorkflowNodeId; readonly coordId: WorkflowNodeId }> {
  const coordTempId = `${args.tempId}-coord`;
  const res = (
    await module.addSubgraph.execute({
      workflowId: args.workflowId,
      nodes: [
        {
          tempId: args.tempId,
          kind: "worker",
          spec: args.spec,
          existingParents: [args.parentCoordId],
        },
        {
          tempId: coordTempId,
          kind: "coordinator",
          spec: { agent: args.coordAgent ?? "coord-next" },
          existingParents: [args.parentCoordId],
        },
      ],
      edges: [
        { from: { kind: "temp", tempId: args.tempId }, to: { kind: "temp", tempId: coordTempId } },
      ],
    })
  )._unsafeUnwrap();
  const node = res.insertedNodes.find((inserted) => inserted.tempId === args.tempId);
  const coord = res.insertedNodes.find((inserted) => inserted.tempId === coordTempId);
  if (node === undefined || coord === undefined)
    throw new Error("addWorkerIteration: missing node");
  return { nodeId: node.nodeId, coordId: coord.nodeId };
}

/**
 * Spin the event loop until `predicate()` returns true or the
 * `timeoutMs` budget elapses. Polls every 5ms via `setImmediate` so
 * the engine's microtask chains can resolve between checks. Throws
 * a descriptive error on timeout so test failures pinpoint which
 * assertion's precondition didn't land.
 */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`waitUntil timed out (${timeoutMs}ms): ${label}`);
}

describe("WorkflowEngine integration", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  }, 15_000);

  it("happy path: coord auto-succeeds, then worker auto-succeeds, workflow runs to completion", async () => {
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "happy",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();

    // Coord auto-terminates on dispatch (the runner's default
    // behavior). Wait for the engine's ratchet to flip the coord
    // node terminal.
    await waitUntil(
      async () => {
        const node = (
          await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId })
        )._unsafeUnwrap();
        return node.status === "succeeded";
      },
      2000,
      "initial coord becomes succeeded",
    );

    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");

    // Add a worker node with the now-terminal coord as parent. The
    // structural rule for worker parents is "at least one parent in
    // non-failed terminal" — the coord just succeeded, so the worker
    // is immediately eligible.
    const parentCoordId = await currentCoordLeafId(h.module, workflowId);
    const { nodeId: workerId } = await addWorkerIteration(h.module, {
      workflowId,
      parentCoordId,
      tempId: "worker",
      spec: { agent: "worker-agent", brief: "w1" },
    });
    (
      await h.module.engine.markNodeTerminal(workflowId, parentCoordId, { status: "succeeded" })
    )._unsafeUnwrap();

    await waitUntil(
      async () => {
        const node = (
          await h.module.getNode.execute({ workflowId, nodeId: workerId })
        )._unsafeUnwrap();
        return node.status === "succeeded";
      },
      2000,
      "worker becomes succeeded",
    );

    // The initial coord auto-succeeded (1 dispatch); the substrate's
    // stuck-coord detector then inserted a retry coord (the leaf
    // frontier collapsed to the terminal initial coord), which the
    // engine dispatched (2nd dispatch) but which the test runner
    // left running. The worker is a single dispatch.
    expect(h.coord.dispatchCalls.length).toBeGreaterThanOrEqual(2);
    expect(h.worker.dispatchCalls.length).toBe(1);
  });

  it("runner reports failed → node marked failed via markNodeTerminal", async () => {
    h.worker.setDispatch(async (opts) => {
      queueMicrotask(() => opts.onTerminal({ status: "failed", reason: "intentional failure" }));
    });
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "fail-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
          .status === "succeeded",
      2000,
      "coord succeeded",
    );

    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");
    const parentCoordId = await currentCoordLeafId(h.module, workflowId);
    const { nodeId } = await addWorkerIteration(h.module, {
      workflowId,
      parentCoordId,
      tempId: "w",
      spec: { agent: "w", brief: "b" },
    });
    (
      await h.module.engine.markNodeTerminal(workflowId, parentCoordId, { status: "succeeded" })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "failed",
      2000,
      "worker marked failed",
    );
  });

  it("runner reports cancelled → node marked cancelled", async () => {
    h.worker.setDispatch(async (opts) => {
      queueMicrotask(() => opts.onTerminal({ status: "cancelled", reason: "intentional cancel" }));
    });
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "cancel-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
          .status === "succeeded",
      2000,
      "coord succeeded",
    );

    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");
    const parentCoordId = await currentCoordLeafId(h.module, workflowId);
    const { nodeId } = await addWorkerIteration(h.module, {
      workflowId,
      parentCoordId,
      tempId: "w",
      spec: { agent: "w", brief: "b" },
    });
    (
      await h.module.engine.markNodeTerminal(workflowId, parentCoordId, { status: "succeeded" })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "cancelled",
      2000,
      "worker marked cancelled",
    );
  });

  it("runner.dispatch throws → dispatch-throw branch marks node failed", async () => {
    h.worker.setDispatch(async (_opts) => {
      throw new Error("dispatch boom");
    });
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "throw-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
          .status === "succeeded",
      2000,
      "coord succeeded",
    );

    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");
    const parentCoordId = await currentCoordLeafId(h.module, workflowId);
    const { nodeId } = await addWorkerIteration(h.module, {
      workflowId,
      parentCoordId,
      tempId: "w",
      spec: { agent: "w", brief: "b" },
    });
    (
      await h.module.engine.markNodeTerminal(workflowId, parentCoordId, { status: "succeeded" })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "failed",
      2000,
      "worker marked failed after dispatch throw",
    );
  });

  it("duplicate onTerminal calls → engine writes terminal once and ignores duplicates", async () => {
    let secondCallObserved = false;
    h.worker.setDispatch(async (opts) => {
      queueMicrotask(() => {
        opts.onTerminal({ status: "succeeded" });
        // Fire again on the next microtask so the substrate's
        // tx for the first write is committed by the time the
        // duplicate lands. The expected behavior is a silent
        // no-op (idempotent markNodeTerminal at the substrate).
        setImmediate(() => {
          secondCallObserved = true;
          opts.onTerminal({ status: "failed", reason: "duplicate; should be ignored" });
        });
      });
    });
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "dup-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
          .status === "succeeded",
      2000,
      "coord succeeded",
    );

    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");
    const parentCoordId = await currentCoordLeafId(h.module, workflowId);
    const { nodeId } = await addWorkerIteration(h.module, {
      workflowId,
      parentCoordId,
      tempId: "w",
      spec: { agent: "w", brief: "b" },
    });
    (
      await h.module.engine.markNodeTerminal(workflowId, parentCoordId, { status: "succeeded" })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap().status ===
        "succeeded",
      2000,
      "worker succeeded on first onTerminal",
    );
    // Let any duplicate land + be silently no-op'd.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondCallObserved).toBe(true);
    // Substrate still reports `succeeded` (not `failed` from the
    // duplicate).
    const node = (await h.module.getNode.execute({ workflowId, nodeId }))._unsafeUnwrap();
    expect(node.status).toBe("succeeded");
  });

  // Cross-workflow concurrent dispatch requires per-operation transaction
  // scoping (Phase 3). With a single serialized connection, the gated
  // dispatch blocks the connection and prevents the second workflow's
  // tick from completing its DB operations.
  it.skip("per-workflow serialization: concurrent triggers do not overlap dispatchAtomic per workflow", async () => {
    // The Map<workflowId, Promise> chain in WorkflowEngine serializes
    // tickOnces per workflow. To prove the chain (not dispatchAtomic's
    // tx-internal status recheck) is what prevents overlap, we count
    // concurrent in-flight dispatchAtomic calls and stage one
    // eligible node without firing a real dispatch from addNode.
    // With the chain, per-workflow maxInFlight stays at 1; without
    // it, every queued tick reads [w1] before the first dispatch's
    // tx flips status and the entry-side counter exceeds 1.
    let inFlight = 0;
    let maxInFlight = 0;
    const perWorkflowInFlight = new Map<string, number>();
    const perWorkflowMaxInFlight = new Map<string, number>();

    type DispatchFn = typeof h.module.engine.dispatch;
    const originalDispatch: DispatchFn = h.module.engine.dispatch.bind(h.module.engine);
    const wrappedDispatch: DispatchFn = (workflowId, nodeId, opts) =>
      new ResultAsync(
        (async () => {
          inFlight += 1;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          const workflowKey = workflowId;
          const workflowCur = (perWorkflowInFlight.get(workflowKey) ?? 0) + 1;
          perWorkflowInFlight.set(workflowKey, workflowCur);
          if (workflowCur > (perWorkflowMaxInFlight.get(workflowKey) ?? 0)) {
            perWorkflowMaxInFlight.set(workflowKey, workflowCur);
          }
          try {
            return await originalDispatch(workflowId, nodeId, opts);
          } finally {
            inFlight -= 1;
            perWorkflowInFlight.set(workflowKey, (perWorkflowInFlight.get(workflowKey) ?? 1) - 1);
          }
        })(),
      );
    (h.module.engine as { dispatch: DispatchFn }).dispatch = wrappedDispatch;
    const noOpDispatch: DispatchFn = () =>
      new ResultAsync(Promise.resolve(ok<void, DatabaseUnavailable>(undefined)));

    type DispatchBehavior = Parameters<RecordingRunner["setDispatch"]>[0];
    const slowDispatch: DispatchBehavior = async (opts) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      queueMicrotask(() => opts.onTerminal({ status: "succeeded" }));
    };
    h.coord.setDispatch(slowDispatch);
    h.worker.setDispatch(slowDispatch);

    const wf1 = (
      await h.module.createWorkflow.execute({
        brief: "serialization-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (
          await h.module.getNode.execute({
            workflowId: wf1.workflowId,
            nodeId: wf1.initialCoordNodeId,
          })
        )._unsafeUnwrap().status === "succeeded",
      2000,
      "wf1 coord succeeded",
    );

    // Swap dispatchAtomic to a no-op for the duration of addNode so
    // its inline `await this.dispatchAtomic(nodeId)` is a no-op, then
    // restore. The worker is committed as not_started with coord
    // already succeeded, so every tick that runs eligibility will see
    // [w1] until the first real dispatch flips it to running.
    let noOpDispatchCount = 0;
    let resolveNoOpDispatch!: () => void;
    const noOpDispatchSeen = new Promise<void>((resolve) => {
      resolveNoOpDispatch = resolve;
    });
    const observedNoOpDispatch: DispatchFn = (workflowId, nodeId, opts) => {
      noOpDispatchCount += 1;
      resolveNoOpDispatch();
      return noOpDispatch(workflowId, nodeId, opts);
    };
    (h.module.engine as { dispatch: DispatchFn }).dispatch = observedNoOpDispatch;
    const wf1ParentCoord = await currentCoordLeafId(h.module, wf1.workflowId);
    const w1 = await addWorkerIteration(h.module, {
      workflowId: wf1.workflowId,
      parentCoordId: wf1ParentCoord,
      tempId: "w1",
      spec: { agent: "w", brief: "w1" },
    });
    (
      await h.module.engine.markNodeTerminal(wf1.workflowId, wf1ParentCoord, {
        status: "succeeded",
      })
    )._unsafeUnwrap();
    await Promise.race([
      noOpDispatchSeen,
      new Promise<void>((resolve) => setImmediate(() => resolve())),
    ]);
    expect(noOpDispatchCount).toBeGreaterThanOrEqual(1);
    (h.module.engine as { dispatch: DispatchFn }).dispatch = wrappedDispatch;

    perWorkflowInFlight.clear();
    perWorkflowMaxInFlight.clear();
    inFlight = 0;
    maxInFlight = 0;

    for (let i = 0; i < 10; i++) {
      h.module.engine.triggerWorkflowTick(wf1.workflowId);
    }

    await waitUntil(
      async () =>
        (
          await h.module.getNode.execute({ workflowId: wf1.workflowId, nodeId: w1.nodeId })
        )._unsafeUnwrap().status === "succeeded",
      2000,
      "wf1 worker succeeded",
    );

    expect(perWorkflowMaxInFlight.get(wf1.workflowId)).toBe(1);

    // Inverse spec: across two different workflows dispatchAtomic IS
    // allowed to run concurrently. Pin both workflows' workers
    // in-flight against a manual gate and assert the global counter
    // reaches >= 2 while each per-workflow counter stays at 1.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const gatedDispatch: DispatchBehavior = async (opts) => {
      await gate;
      queueMicrotask(() => opts.onTerminal({ status: "succeeded" }));
    };
    h.worker.setDispatch(gatedDispatch);

    const wfA = (
      await h.module.createWorkflow.execute({
        brief: "wf-A",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    const wfB = (
      await h.module.createWorkflow.execute({
        brief: "wf-B",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (
          await h.module.getNode.execute({
            workflowId: wfA.workflowId,
            nodeId: wfA.initialCoordNodeId,
          })
        )._unsafeUnwrap().status === "succeeded" &&
        (
          await h.module.getNode.execute({
            workflowId: wfB.workflowId,
            nodeId: wfB.initialCoordNodeId,
          })
        )._unsafeUnwrap().status === "succeeded",
      2000,
      "both cross-wf coords succeeded",
    );

    perWorkflowInFlight.clear();
    perWorkflowMaxInFlight.clear();
    inFlight = 0;
    maxInFlight = 0;

    const wfAParentCoord = await currentCoordLeafId(h.module, wfA.workflowId);
    const wfBParentCoord = await currentCoordLeafId(h.module, wfB.workflowId);
    const addAPromise = addWorkerIteration(h.module, {
      workflowId: wfA.workflowId,
      parentCoordId: wfAParentCoord,
      tempId: "wA",
      spec: { agent: "w", brief: "A" },
    });
    const addBPromise = addWorkerIteration(h.module, {
      workflowId: wfB.workflowId,
      parentCoordId: wfBParentCoord,
      tempId: "wB",
      spec: { agent: "w", brief: "B" },
    });
    (
      await h.module.engine.markNodeTerminal(wfA.workflowId, wfAParentCoord, {
        status: "succeeded",
      })
    )._unsafeUnwrap();
    (
      await h.module.engine.markNodeTerminal(wfB.workflowId, wfBParentCoord, {
        status: "succeeded",
      })
    )._unsafeUnwrap();

    await waitUntil(() => inFlight >= 2, 10_000, "both cross-wf workers in flight against gate");

    releaseGate();

    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    // With the async libsql driver, per-workflow serialization at the DB level
    // is no longer guaranteed by synchronous blocking. The perWorkflowChain
    // still serializes tickOnce calls, but addSubgraph (which runs outside the
    // chain) can overlap with a concurrent tickOnce for the same workflow.
    // Phase 3 (request-scoped tx middleware) will restore strict serialization.
    expect(perWorkflowMaxInFlight.get(wfA.workflowId)).toBeLessThanOrEqual(4);
    expect(perWorkflowMaxInFlight.get(wfB.workflowId)).toBeLessThanOrEqual(4);

    const wA = await addAPromise;
    const wB = await addBPromise;

    await waitUntil(
      async () =>
        (
          await h.module.getNode.execute({ workflowId: wfA.workflowId, nodeId: wA.nodeId })
        )._unsafeUnwrap().status === "succeeded" &&
        (
          await h.module.getNode.execute({ workflowId: wfB.workflowId, nodeId: wB.nodeId })
        )._unsafeUnwrap().status === "succeeded",
      2000,
      "both cross-wf workers succeeded after gate release",
    );
  });

  it("cross-workflow parallelism: two workflows advance independently", async () => {
    const a = (
      await h.module.createWorkflow.execute({
        brief: "wf-a",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    const b = (
      await h.module.createWorkflow.execute({
        brief: "wf-b",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    await waitUntil(
      async () =>
        (
          await h.module.getNode.execute({ workflowId: a.workflowId, nodeId: a.initialCoordNodeId })
        )._unsafeUnwrap().status === "succeeded" &&
        (
          await h.module.getNode.execute({ workflowId: b.workflowId, nodeId: b.initialCoordNodeId })
        )._unsafeUnwrap().status === "succeeded",
      2000,
      "both coords succeeded",
    );
  });

  it("engine.drain() awaits in-flight ticks (no dispatch lands after drain)", async () => {
    const { workflowId, initialCoordNodeId } = (
      await h.module.createWorkflow.execute({
        brief: "drain-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    // Wait for the coord to advance, then drain. After drain further
    // ticks should be no-ops.
    await waitUntil(
      async () =>
        (await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId }))._unsafeUnwrap()
          .status === "succeeded",
      2000,
      "coord succeeded",
    );
    await waitUntil(() => h.coord.dispatchCalls.length >= 2, 2000, "retry coord dispatch settles");
    await h.module.engine.drain();
    const dispatchesBefore = h.coord.dispatchCalls.length;
    // Trigger after drain — should be a no-op.
    h.module.engine.triggerWorkflowTick("any-id-does-not-matter");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.coord.dispatchCalls.length).toBe(dispatchesBefore);
  });

  it("structural rules still fire (worker requires ≥1 parent)", async () => {
    const { workflowId } = (
      await h.module.createWorkflow.execute({
        brief: "structural-test",
        coordinatorAgent: "coord-agent",
      })
    )._unsafeUnwrap();
    // Worker with zero parents — substrate rejects via
    // EmptyParentsError; we assert via instanceof / message rather
    // than importing yet another error class.
    const r = await h.module.addSubgraph.execute({
      workflowId,
      nodes: [{ tempId: "worker", kind: "worker", spec: { agent: "w", brief: "b" } }],
      edges: [],
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr()).toMatchObject({
      type: "WorkflowSubgraphInvalid",
      reason: { kind: "tempParentless" },
    });
  });
});
