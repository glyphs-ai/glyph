/**
 * Integration tests for `makeCoordNodeRunner` wired into a real
 * `composeWorkflowModule`. Uses a fake `TaskModule` whose
 * `dispatch` records calls and `get` returns scripted statuses, so
 * the substrate, runner, and task module run end-to-end
 * without standing up a real `@glyphs-ai/task` host (which would pull
 * in a runtime registry, an agent resolver, and a real workspace
 * dir for no extra coverage of THIS runner's behavior).
 *
 * Two-phase init demonstration: the coord runner is built with a
 * `getModule` thunk that closes over a mutable holder; after
 * `composeWorkflowModule` returns, the holder is populated with the
 * actual `WorkflowModule`. Mirrors the engine ↔ module two-phase
 * init in `@glyphs-ai/workflow`.
 *
 * The worker runner is a passthrough stub that never gets exercised
 * by these scenarios (no `addNode kind:'worker'` calls land); it
 * exists only because `WorkflowRunners` requires both fields.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TaskModule } from "@glyphs-ai/task";
import {
  composeWorkflowModule,
  type WorkflowModule,
  type WorkflowNodeRunner,
} from "@glyphs-ai/workflow";
import { okAsync } from "neverthrow";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCoordNodeRunner } from "../../src/wiring/workflow-coord-task-runner.js";

type CatalogAgentLookup = Parameters<typeof makeCoordNodeRunner>[0]["catalog"];

const silentLogger = pino({ level: "silent" });

// biome-ignore lint/suspicious/noExplicitAny: minimal Task-shaped object; the runner only reads id/status/success/failure.
function fakeTaskRow(overrides: Partial<{ id: string; status: string }> = {}): any {
  return {
    id: overrides.id ?? "task-id-1",
    status: overrides.status ?? "succeeded",
    metadata: {},
    agent: "coord-agent",
    brief: "wf-brief",
    origin: "workflow",
    createdAt: "2026-06-07T00:00:00.000Z",
    startedAt: "2026-06-07T00:00:00.000Z",
  };
}

interface Harness {
  readonly module: WorkflowModule;
  readonly tasks: TaskModule;
  readonly dispatch: ReturnType<typeof vi.fn>;
  readonly get: ReturnType<typeof vi.fn>;
  readonly workspaceDir: string;
  cleanup(): Promise<void>;
}

interface MakeHarnessOpts {
  readonly initialTaskStatus?: "running" | "succeeded" | "failed" | "cancelled";
}

async function makeHarness(opts: MakeHarnessOpts = {}): Promise<Harness> {
  const initialStatus = opts.initialTaskStatus ?? "succeeded";

  const dispatch = vi.fn(() => okAsync(fakeTaskRow({ id: "tid-1", status: initialStatus })));
  const get = vi.fn((_req: { id: string }) =>
    okAsync(fakeTaskRow({ id: "tid-1", status: initialStatus })),
  );
  const hasInFlightForWorkflowNode = vi.fn(() => okAsync(false));
  const listInFlightForWorkflowNode = vi.fn(() => okAsync([]));
  const cancel = vi.fn(() => okAsync(fakeTaskRow()));
  const tasks = {
    dispatchTask: { execute: dispatch },
    getTask: { execute: get },
    hasInFlightByOrigin: { execute: hasInFlightForWorkflowNode },
    listInFlightByOrigin: { execute: listInFlightForWorkflowNode },
    cancelTask: { execute: cancel },
  } as unknown as TaskModule;

  const getAgent = vi.fn(async (_fqn: string) => ({
    name: "coord-agent",
    // The coord runner requires a non-empty `dependencies.agents`
    // dispatch menu on the resolved coord agent. The integration
    // harness doesn't dispatch any workers (worker runner is a
    // passthrough stub), but the fixture still has to satisfy that
    // capability check so `createWorkflow` can construct the initial
    // coord node.
    dependencies: { agents: [{ fqn: "worker" }] },
  }));
  const catalog = { getAgent } as unknown as CatalogAgentLookup;

  // Two-phase init holder. Populated after `composeWorkflowModule`
  // returns, matching the engine ↔ service composition pattern.
  const serviceHolder: { service: import("@glyphs-ai/workflow").WorkflowModule | null } = {
    service: null,
  };

  // Create the workspaceDir up front so the coord runner can capture
  // it as a required dep. The workflow substrate composed below will
  // reuse this same dir as the root for
  // `workflowDir(workspaceDir, wfid)`.
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "wf-coord-runner-int-"));

  const coordRunner = makeCoordNodeRunner({
    tasks,
    catalog,
    getModule: () => {
      const s = serviceHolder.service;
      if (s === null) {
        throw new Error(
          "integration harness: serviceHolder.service is still null; compose did not return",
        );
      }
      return s;
    },
    workspaceDir,
    pollIntervalMs: 25,
    maxPollErrors: 3,
  });

  // Worker stub — not exercised by these scenarios; present only
  // because `WorkflowRunners` requires both kinds.
  const workerRunner: WorkflowNodeRunner = {
    validate(spec) {
      return okAsync(spec);
    },
    dispatch(_opts) {
      return okAsync(undefined);
    },
    hasInFlightForNode(_nodeId) {
      return okAsync(false);
    },
    cancel(_nodeId) {
      return okAsync(undefined);
    },
    listArtifacts() {
      return okAsync(null);
    },
    resolveArtifactPath() {
      return okAsync(null);
    },
  };

  const module = await composeWorkflowModule({
    dbFile: ":memory:",
    workspaceDir,
    runners: {
      coordinator: coordRunner,
      worker: workerRunner,
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
  serviceHolder.service = module;

  return {
    module,
    tasks,
    dispatch,
    get,
    workspaceDir,
    async cleanup() {
      await coordRunner.dispose();
      await module.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

/**
 * Spin the event loop until `predicate()` returns truthy or the
 * `timeoutMs` budget elapses. Polls every 5ms via `setImmediate`.
 * Mirrors the helper in `engine-integration.test.ts`.
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

describe("makeCoordNodeRunner — integration with composeWorkflowModule", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("I1: createWorkflow → coord task auto-dispatches via tasks.dispatchTask.execute with brief+details from workflow header", async () => {
    const created1 = await h.module.createWorkflow.execute({
      brief: "my brief",
      details: "my long details",
      coordinatorAgent: "coord-agent",
    });
    if (created1.isErr()) throw new Error(created1.error.type);
    const { workflowId, initialCoordNodeId } = created1.value;

    await waitUntil(
      () => h.dispatch.mock.calls.length >= 1,
      2000,
      "tasks.dispatchTask.execute called",
    );

    const calls = h.dispatch.mock.calls as unknown as ReadonlyArray<
      readonly [Record<string, unknown>]
    >;
    const call = calls[0]?.[0];
    expect(call).toBeDefined();
    if (call !== undefined) {
      expect(call.agent).toBe("coord-agent");
      expect(call.brief).toBe("my brief");
      expect(call.details).toBe("my long details");
      expect(call.origin).toBe("workflow");
      expect(call.originId).toBe(initialCoordNodeId);
      expect(call.metadata).toEqual({
        workflowId,
      });
    }
  });

  it("I2: createWorkflow without details → coord tasks.dispatchTask.execute called without 'details' key", async () => {
    const created = await h.module.createWorkflow.execute({
      brief: "brief only",
      coordinatorAgent: "coord-agent",
    });
    if (created.isErr()) throw new Error(created.error.type);

    await waitUntil(
      () => h.dispatch.mock.calls.length >= 1,
      2000,
      "tasks.dispatchTask.execute called",
    );

    const calls = h.dispatch.mock.calls as unknown as ReadonlyArray<
      readonly [Record<string, unknown>]
    >;
    const call = calls[0]?.[0];
    expect(call).toBeDefined();
    if (call !== undefined) {
      expect(call.brief).toBe("brief only");
      expect(Object.keys(call)).not.toContain("details");
    }
  });

  it("I3: coord task succeeds via fake tasks.getTask.execute → substrate marks coord node succeeded", async () => {
    const created3 = await h.module.createWorkflow.execute({
      brief: "succeed-test",
      coordinatorAgent: "coord-agent",
    });
    if (created3.isErr()) throw new Error(created3.error.type);
    const { workflowId, initialCoordNodeId } = created3.value;

    await waitUntil(
      async () => {
        const node = await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId });
        if (node.isErr()) throw new Error(node.error.type);
        return node.value.status === "succeeded";
      },
      2000,
      "coord node observed succeeded after fake tasks.getTask.execute returns succeeded",
    );

    const node = await h.module.getNode.execute({ workflowId, nodeId: initialCoordNodeId });
    if (node.isErr()) throw new Error(node.error.type);
    expect(node.value.status).toBe("succeeded");
    // The initial coord succeeded without any children; the
    // substrate's stuck-coord detector fires
    // and inserts a retry coord which the engine immediately
    // dispatches via the same fake tasks.dispatchTask.execute. Total calls = 2.
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.get.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
