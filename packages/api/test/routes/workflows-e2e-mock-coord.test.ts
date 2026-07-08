/**
 * End-to-end acceptance test for the coord-callback HTTP surface.
 *
 * Scope: spin up a real `WorkflowModule` (in-memory SQLite, mock per-
 * kind runners), mount `workflowsRoutes` against it, then drive a
 * complete workflow lifecycle via HTTP. Asserts the wire shapes and
 * status codes for the live (substrate-backed) round-trip — distinct
 * from `workflows.test.ts` whose stubs assert only the route layer.
 *
 * Coverage:
 *   1. HTTP `POST /workflows` seeds a workflow + coord row.
 *   2. Engine ticks coord to `succeeded` via mock runner.
 *   3. HTTP `POST /workflows/:wfid/subgraph` inserts a worker
 *      attached to the (now-terminal) coord via `existingParents`.
 *   4. Engine ticks worker to `succeeded`.
 *   5. HTTP `POST /workflows/:wfid/finish` succeeds — the substrate's
 *      workflow-lifecycle gate is satisfied (the workflow is still
 *      `running`) and the call flips it to `succeeded`.
 *   6. HTTP `POST /workflows/:wfid/cancel` after `finish` surfaces
 *      409 with `code='WorkflowAlreadyTerminalError'` — proves the
 *      lifecycle gate fires through the HTTP→policy pipeline.
 *
 * Why this lives in `routes/` (not in a separate `e2e/`): it asserts
 * route-level wiring (URL paths, status codes, body shapes) against a
 * substrate composed in-process. The vitest config doesn't need to
 * change — same test runner, no port allocation, no subprocess.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TaskModule } from "@glyphs-ai/task";
import {
  applyWorkflowMigrations,
  composeWorkflowModule,
  type WorkflowModule,
  type WorkflowNodeRunner,
  type WorkflowNodeTerminalResult,
  schema as workflowSchema,
} from "@glyphs-ai/workflow";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { okAsync } from "neverthrow";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowsRoutes } from "../../src/routes/workflows.js";

const silentLogger = pino({ level: "silent" });

interface AutoSucceedRunner extends WorkflowNodeRunner {
  readonly dispatchCalls: ReadonlyArray<{
    readonly workflowId: string;
    readonly nodeId: string;
  }>;
}

function makeAutoSucceedRunner(
  label: string,
  opts: { readonly gated: boolean },
): AutoSucceedRunner {
  const dispatchCalls: Array<{ workflowId: string; nodeId: string }> = [];
  // Per-workflow first-dispatch gate (coord runner only). The
  // substrate's stuck-coord detector inserts a
  // retry coord whenever a coord exits without children. Without
  // this gate, the retry's auto-success would trigger another retry,
  // ad infinitum (capped at 5 by the substrate but still 6 extra
  // dispatches per workflow). Gating keeps later COORD dispatches
  // recorded but in `running` so the test scenarios stay
  // deterministic. Worker runner is ungated — multiple workers per
  // workflow should all auto-succeed. Mirrors
  // `engine-integration.test.ts`.
  const autoSucceededWorkflows = new Set<string>();
  let seq = 0;
  const runner: AutoSucceedRunner = {
    dispatchCalls,
    validate(spec) {
      return okAsync(spec);
    },
    dispatch(dispatchOpts: {
      readonly workflowId: string;
      readonly nodeId: string;
      readonly spec: unknown;
      readonly onTerminal: (result: WorkflowNodeTerminalResult) => void;
    }) {
      dispatchCalls.push({ workflowId: dispatchOpts.workflowId, nodeId: dispatchOpts.nodeId });
      if (opts.gated && autoSucceededWorkflows.has(dispatchOpts.workflowId)) {
        return okAsync(undefined);
      }
      autoSucceededWorkflows.add(dispatchOpts.workflowId);
      // Push the terminal onto the microtask queue so the engine has
      // a chance to commit `ready → running` first (mirrors production
      // timing where dispatch returns before the unit settles).
      queueMicrotask(() => dispatchOpts.onTerminal({ status: "succeeded" }));
      seq += 1;
      // Stub still tracks a per-call identifier mirroring the runner's
      // task-id log line; the substrate does not consume it.
      void `${label}-unit-${seq}`;
      return okAsync(undefined);
    },
    hasInFlightForNode() {
      return okAsync(false);
    },
    cancel() {
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
  readonly app: ReturnType<typeof workflowsRoutes>;
  readonly coord: AutoSucceedRunner;
  readonly worker: AutoSucceedRunner;
  cleanup(): Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const coord = makeAutoSucceedRunner("coord", { gated: true });
  const worker = makeAutoSucceedRunner("worker", { gated: false });
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "wf-e2e-coord-"));
  const client = createClient({ url: "file::memory:" });
  await applyWorkflowMigrations(client);
  const db = drizzle(client, { schema: workflowSchema });
  const module = await composeWorkflowModule({
    db,
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
      } as import("@glyphs-ai/workflow").WorkflowNodeRunner,
    },
    logger: silentLogger,
  });
  const app = workflowsRoutes(
    () => module,
    () =>
      ({
        findLatestByOrigin: { execute: () => okAsync(null) },
      }) as unknown as TaskModule,
    () => workspaceDir,
  );
  return {
    module,
    app,
    coord,
    worker,
    async cleanup() {
      await module.close();
      client.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

/**
 * Spin the event loop until `predicate()` returns true or the budget
 * elapses. Polls every 5ms via `setImmediate` so engine microtasks
 * can resolve between checks.
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

describe("workflowsRoutes — E2E mock-coord acceptance", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it("HTTP create → addSubgraph → cancel drives a workflow over the live substrate", async () => {
    // 1. Create workflow via HTTP — seeds workflow + initial coord node.
    const createRes = await h.app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brief: "ship feature X",
        coordinatorAgent: "mock-coord",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      status: string;
    };
    const wfid = created.id;
    expect(created.status).toBe("running");

    // 2. Wait for the initial coord to auto-succeed. The substrate's
    //    stuck-coord detector then inserts a retry coord and the
    //    engine dispatches it; the runner's per-workflow gate keeps
    //    that retry coord in `running` so this assertion narrows to
    //    the initial coord's status only, not "every node succeeded",
    //    because the retry coord stays non-terminal by design.
    await waitUntil(
      async () => {
        const dagRes = await h.app.request(`/${wfid}/dag`);
        const dag = (await dagRes.json()) as {
          nodes: Array<{ kind: string; status: string }>;
        };
        const initial = dag.nodes.find((n) => n.kind === "coordinator");
        return initial?.status === "succeeded";
      },
      5000,
      "initial coord auto-succeeds",
    );

    // 3. Add a worker via the addSubgraph HTTP surface (exercising the
    //    most complex mutation primitive in one call: temp-id alloc
    //    plus tagged NodeRef edges).
    //    The batch attaches the worker to the (now-succeeded) initial
    //    coord (worker's "all parents succeeded" readiness rule), and
    //    attaches a trailing coord cend to BOTH the detector-inserted
    //    retry coord AND the worker (via a temp edge). With cend
    //    pulling retry off the leaf set, the final leaves = {cend}
    //    satisfies the §3 commit-time {1 coord leaf} invariant; cend
    //    also has a coord-kind parent (the retry) so the
    //    orphanCoordInsert check passes.
    const dagBeforeRes = await h.app.request(`/${wfid}/dag`);
    const dagBefore = (await dagBeforeRes.json()) as {
      nodes: Array<{ id: string; kind: string; status: string }>;
    };
    const coordNodes = dagBefore.nodes.filter((n) => n.kind === "coordinator");
    const initialCoord = coordNodes.find((n) => n.status === "succeeded");
    const retryCoord = coordNodes.find((n) => n.status !== "succeeded");
    expect(initialCoord).toBeDefined();
    expect(retryCoord).toBeDefined();
    const initialCoordId = initialCoord?.id;
    const retryCoordId = retryCoord?.id;
    if (typeof initialCoordId !== "string" || typeof retryCoordId !== "string") {
      throw new Error("coord nodes not found");
    }

    const subgraphRes = await h.app.request(`/${wfid}/subgraph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodes: [
          {
            tempId: "w1",
            kind: "worker",
            spec: { agent: "mock-worker", brief: "do thing" },
            existingParents: [initialCoordId],
          },
          {
            tempId: "cend",
            kind: "coordinator",
            spec: { agent: "mock-coord" },
            existingParents: [retryCoordId],
          },
        ],
        edges: [{ from: { kind: "temp", tempId: "w1" }, to: { kind: "temp", tempId: "cend" } }],
      }),
    });
    expect(subgraphRes.status).toBe(200);
    const subgraphBody = (await subgraphRes.json()) as {
      insertedNodes: Array<{ tempId: string; nodeId: string; phase: number }>;
    };
    expect(subgraphBody.insertedNodes).toHaveLength(2);
    const workerInserted = subgraphBody.insertedNodes.find((n) => n.tempId === "w1");
    expect(workerInserted).toBeDefined();
    const workerNodeId = workerInserted?.nodeId as string;

    // 4. Wait for the worker to auto-succeed.
    await waitUntil(
      async () => {
        const dagRes = await h.app.request(`/${wfid}/dag`);
        const dag = (await dagRes.json()) as {
          nodes: Array<{ id: string; status: string }>;
        };
        const workerRow = dag.nodes.find((n) => n.id === workerNodeId);
        return workerRow?.status === "succeeded";
      },
      5000,
      "worker auto-succeeds",
    );

    // 5. POST /finish succeeds — the workflow is still `running` and
    //    the substrate's lifecycle gate is satisfied.
    const finishRes = await h.app.request(`/${wfid}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "succeeded" }),
    });
    expect(finishRes.status).toBe(200);

    // 6. A follow-up cancel surfaces 409 with the
    //    WorkflowAlreadyTerminalError code — proves the substrate's
    //    lifecycle gate fires through the live substrate → error
    //    policy → HTTP response pipeline.
    const cancelRes = await h.app.request(`/${wfid}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancellation: { kind: "user", message: "e2e test stop" } }),
    });
    expect(cancelRes.status).toBe(409);
    const cancelErr = (await cancelRes.json()) as { code?: string };
    expect(cancelErr.code).toBe("WorkflowAlreadyTerminal");

    // 7. Sanity-check the runner call counts. Coord dispatches: the
    //    initial coord (auto-succeeded) and the detector-inserted
    //    retry coord (gated → running) = 2. The trailing cend coord
    //    never dispatches because its retry-coord parent is still
    //    `running` and coord-readiness requires ALL parents
    //    terminal. Worker dispatches: just w1 = 1.
    expect(h.coord.dispatchCalls).toHaveLength(2);
    expect(h.worker.dispatchCalls).toHaveLength(1);
  }, 15000);
});
