/**
 * Integration tests for `makeCoordNodeRunner` wired into a real
 * `composeWorkflowModule`. Uses a fake `TaskService` whose
 * `dispatch` records calls and `get` returns scripted statuses, so
 * the substrate ↔ runner ↔ task-service bridge runs end-to-end
 * without standing up a real `@glyphs-ai/task` host (which would pull
 * in a runtime registry, an agent resolver, and a real workspace
 * dir for no extra coverage of THIS runner's bridging behaviour).
 *
 * Two-phase init demonstration: the coord runner is built with a
 * `getService` thunk that closes over a mutable holder; after
 * `composeWorkflowModule` returns, the holder is populated with the
 * actual `WorkflowService`. Mirrors the engine ↔ service two-phase
 * init in `@glyphs-ai/workflow`.
 *
 * The worker runner is a passthrough stub that never gets exercised
 * by these scenarios (no `addNode kind:'worker'` calls land); it
 * exists only because `WorkflowRunners` requires both fields.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TaskService } from "@glyphs-ai/task";
import {
  composeWorkflowModule,
  type WorkflowModule,
  type WorkflowNodeRunner,
} from "@glyphs-ai/workflow";
import { openTestWorkflowDb } from "@glyphs-ai/workflow/testing";
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
  readonly tasks: TaskService;
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

  const dispatch = vi.fn(async () => fakeTaskRow({ id: "tid-1", status: initialStatus }));
  const get = vi.fn(async (_id: string) => fakeTaskRow({ id: "tid-1", status: initialStatus }));
  const hasInFlightForWorkflowNode = vi.fn(async () => false);
  const listInFlightForWorkflowNode = vi.fn(async () => []);
  const cancel = vi.fn(async (_id: string) => {});
  const tasks = {
    dispatch,
    get,
    hasInFlightForWorkflowNode,
    listInFlightForWorkflowNode,
    cancel,
  } as unknown as TaskService;

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
  const serviceHolder: { service: import("@glyphs-ai/workflow").WorkflowService | null } = {
    service: null,
  };

  // Create the workspaceDir up front so the coord runner can capture
  // it as a required dep. The workflow substrate composed below will
  // reuse this same dir as the root for
  // `workflowDir(workspaceDir, wfid)`.
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "wf-coord-runner-int-"));
  // Mirror @glyphs-ai/workspace's provisioner: createWorkflow now
  // requires `workflows/` to exist (mkdir leaf is `{recursive:false}`).
  mkdirSync(path.join(workspaceDir, "workflows"));

  const coordRunner = makeCoordNodeRunner({
    tasks,
    catalog,
    getService: () => {
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
    async validate(spec) {
      return spec;
    },
    async dispatch(_opts) {},
    async hasInFlightForNode(_nodeId) {
      return false;
    },
    async cancel(_nodeId) {},
  };

  const dbHandle = openTestWorkflowDb();
  const module = await composeWorkflowModule({
    db: dbHandle.db,
    workspaceDir,
    runners: {
      coordinator: coordRunner,
      worker: workerRunner,
      human: {
        validate: async (s) => s,
        dispatch: async () => {},
        hasInFlightForNode: async () => false,
        cancel: async () => {},
      },
    },
    logger: silentLogger,
  });
  serviceHolder.service = module.service;

  return {
    module,
    tasks,
    dispatch,
    get,
    workspaceDir,
    async cleanup() {
      await coordRunner.dispose();
      await module.close();
      dbHandle.close();
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

  it("I1: createWorkflow → coord task auto-dispatches via tasks.dispatch with brief+details from workflow header", async () => {
    const { workflowId, initialCoordNodeId } = await h.module.service.createWorkflow({
      brief: "my brief",
      details: "my long details",
      coordinatorAgent: "coord-agent",
    });

    await waitUntil(() => h.dispatch.mock.calls.length >= 1, 2000, "tasks.dispatch called");

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

  it("I2: createWorkflow without details → coord tasks.dispatch called without 'details' key", async () => {
    await h.module.service.createWorkflow({
      brief: "brief only",
      coordinatorAgent: "coord-agent",
    });

    await waitUntil(() => h.dispatch.mock.calls.length >= 1, 2000, "tasks.dispatch called");

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

  it("I3: coord task succeeds via fake tasks.get → substrate marks coord node succeeded", async () => {
    const { initialCoordNodeId } = await h.module.service.createWorkflow({
      brief: "succeed-test",
      coordinatorAgent: "coord-agent",
    });

    await waitUntil(
      async () => {
        const node = await h.module.service.getNode(initialCoordNodeId);
        return node.status === "succeeded";
      },
      2000,
      "coord node observed succeeded after fake tasks.get returns succeeded",
    );

    const node = await h.module.service.getNode(initialCoordNodeId);
    expect(node.status).toBe("succeeded");
    // The initial coord succeeded without any children; the
    // substrate's stuck-coord detector fires
    // and inserts a retry coord which the engine immediately
    // dispatches via the same fake tasks.dispatch. Total calls = 2.
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.get.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
