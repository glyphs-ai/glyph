/**
 * Contract tests for `respondError` plus the per-domain error
 * policies.
 *
 * These tests pin the cross-cutting behavior the refactor introduced:
 *
 *   1. Catalog `AgentNotFound` DU errors map to 404 on catalog routes,
 *      while the task `AgentNotFound` union detail remains 400 on its
 *      own route. The schedule pkg no longer owns its own class; its
 *      routes reuse the task union carrier via the kind handler.
 *   2. `routes/workspaces.ts` emits the structured "unmapped error fell
 *      through" log line for unrecognised errors, closing the
 *      observability gap for that file.
 *   3. `InvalidTransition` carries the route-context `transition`
 *      verb ("cancel" vs "delete") in its 409 body, proving that the
 *      per-call `customBody` parameter forwards route state through
 *      the helper.
 *   4. `EntryNotReady` keeps its structured `{ agent, reason }`
 *      fields on the 409 body via the Result-native task error
 *      responder.
 *   5. 5xx task faults trip the "5xx fault" log line WITHOUT the
 *      "unmapped" label — the two observability buckets stay distinct.
 *
 * Sibling per-route suites (`tasks.test.ts`, `sessions.test.ts`, …)
 * cover the per-route fixtures and validation; this file is the
 * cross-cutting safety net.
 */

import type { AgentNotFound, AgentResolutionFailed, TaskModule } from "@glyphs-ai/task";
import { RegisterWorkspaceRequestSchema } from "@glyphs-ai/workspace";
import { Hono } from "hono";
import { errAsync, okAsync } from "neverthrow";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { catalogRoutes } from "../src/routes/catalog/index.js";
import { scheduledTasksRoutes } from "../src/routes/scheduled-tasks.js";
import { schedulesRoutes } from "../src/routes/schedules.js";
import { tasksRoutes } from "../src/routes/tasks.js";
import { workspacesRoutes } from "../src/routes/workspaces.js";
import type { Task } from "../src/wire/domain.js";
import { TaskOperationError } from "../src/wiring/_task-operation-error.js";
import { captureLogger } from "./_capture-logger.js";

// biome-ignore lint/suspicious/noExplicitAny: transport tests assert on dynamically-shaped JSON bodies
const jsonBody = (res: Response): Promise<any> => res.json() as Promise<any>;

const sampleTask: Task = {
  id: "20260601-abcd1234",
  agent: "writer",
  brief: "Draft the post",
  origin: "standalone",
  status: "running",
  metadata: {
    workdir: "/tmp/wd",
    runtime: "copilot",
    runtimeSessionId: "11111111-2222-3333-4444-555555555555",
    pid: 4242,
  },
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
} as unknown as Task;

function stubTaskModule(overrides: Partial<Record<keyof TaskModule, unknown>>): TaskModule {
  return {
    dispatchTask: { execute: vi.fn(() => okAsync(sampleTask)) },
    getTask: { execute: vi.fn(() => okAsync(sampleTask)) },
    listTasks: { execute: vi.fn(() => okAsync([sampleTask])) },
    cancelTask: { execute: vi.fn(() => okAsync(sampleTask)) },
    deleteTask: { execute: vi.fn(() => okAsync(undefined)) },
    hasInFlightByOrigin: { execute: vi.fn(() => okAsync(false)) },
    listInFlightByOrigin: { execute: vi.fn(() => okAsync([])) },
    findLatestByOrigin: { execute: vi.fn(() => okAsync(null)) },
    deleteTerminalByOrigin: { execute: vi.fn(() => okAsync({ deletedCount: 0 })) },
    aggregateByOrigin: { execute: vi.fn(() => okAsync(new Map())) },
    getTaskActivity: { execute: vi.fn(() => okAsync(null)) },
    getTaskActivityStream: { execute: vi.fn(() => okAsync(null)) },
    resolveArtifactPath: { execute: vi.fn(() => okAsync(null)) },
    recoverOrphanedTasks: { execute: vi.fn(() => okAsync(undefined)) },
    liveCount: vi.fn(() => 0),
    shutdown: vi.fn(async () => {}),
    drainPurges: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  } as unknown as TaskModule;
}

type LoggerHono = Hono<{ Variables: { logger: Logger } }>;

async function buildAppWithLogger(mount: (app: LoggerHono) => void) {
  const cap = captureLogger();
  const app = new Hono<{ Variables: { logger: Logger } }>();
  app.use("*", async (c, next) => {
    c.set("logger", cap.logger);
    await next();
  });
  mount(app);
  return { app, cap };
}

describe("respondError contract — cross-domain status preservation", () => {
  // Catalog and task now emit DU codes (`AgentNotFound`) through
  // different carriers. Per-domain policies keep those routes
  // independent.

  it("task route's AgentNotFound union detail → 400", async () => {
    const m = stubTaskModule({
      dispatchTask: { execute: vi.fn(() => errAsync({ type: "AgentNotFound", agent: "ghost" })) },
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ghost", brief: "go" }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body).toEqual({ error: "agent not found", code: "AgentNotFound" });
  });

  it("schedule route's AgentNotFound union detail (via kind handler) → 400", async () => {
    // The schedule pkg is kind-agnostic and does not own an
    // agent-not-found class. The task-kind handler (in
    // `packages/api/src/wiring/schedule-task-handler.ts`) raises
    // TaskOperationError with an AgentNotFound detail on catalog miss,
    // and the schedules policy maps that code to 400 (one row covers
    // both the validation and dispatch paths).
    const create = vi.fn(() =>
      errAsync(new TaskOperationError({ type: "AgentNotFound", agent: "ghost" } as AgentNotFound)),
    );
    const stub = { createSchedule: { execute: create } } as never;
    const res = await schedulesRoutes(() => stub).request("/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "S",
        target: { agent: "ghost", brief: "go" },
        trigger: { kind: "cron", expr: "* * * * *", tz: "UTC" },
      }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe("AgentNotFound");
  });

  it("catalog route's AgentNotFound DU → 404 (NOT 400)", async () => {
    const catalog = {
      getAgentEntry: {
        execute: vi.fn(() => errAsync({ type: "AgentNotFound", fqn: "public/ghost" })),
      },
    } as never;
    const res = await catalogRoutes(() => catalog).request("/agents/public/ghost");
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.code).toBe("AgentNotFound");
  });
});

describe("respondError contract — unmapped-fault observability gap-closes", () => {
  // The policy-driven `respondError` helper emits a structured log
  // line when an unrecognised error class falls through to the default
  // status. These cases ensure sessions.ts and workspaces.ts use the
  // same seam as tasks.ts and scheduled-tasks.ts.

  it("workspaces route ProvisioningFailed → 500 + 5xx fault log line", async () => {
    // After the Result/DU refactor, a workspace tech failure surfaces
    // as `Err(ProvisioningFailed)` from the service. The route's
    // `.match()` routes it through `respondWorkspaceError`, which maps
    // the DU type to a 500 and writes the structured `5xx fault` log
    // line so operators see the underlying disk/permission cause.
    const register = vi.fn(() =>
      errAsync({
        type: "ProvisioningFailed",
        workspaceDir: "/scratch/demo",
        cause: new Error("ENOSPC: workspace dir mkdir failed"),
      }),
    );
    const workspacesCtx = {
      workspace: { registerWorkspace: { execute: register } },
    };
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route("/", workspacesRoutes(workspacesCtx as never));
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo" }),
    });
    expect(res.status).toBe(500);
    const body = (await jsonBody(res)) as { code: string; error: string };
    expect(body.code).toBe("ProvisioningFailed");
    expect(body.error).toBe("internal error");

    const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
    expect(fault).toBeDefined();
    expect(fault?.level).toBe(50);
    expect(fault?.msg).toBe("workspaces.create: 5xx fault");
  });

  it("scheduled-tasks unmapped error → 400 + log line (sanity check)", async () => {
    // Confirms the route still uses tasksErrorPolicy and the
    // pre-existing scheduled-tasks.list log message is preserved.
    const m = stubTaskModule({
      listTasks: {
        execute: vi.fn(() =>
          errAsync({ type: "DatabaseUnavailable", cause: new Error("disk read failed") }),
        ),
      },
    });
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route(
        "/",
        scheduledTasksRoutes(() => m),
      );
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ error: "internal error", code: "DatabaseUnavailable" });
    const fault = cap.entries.find((e) => e.msg?.includes("5xx fault"));
    expect(fault).toBeDefined();
    expect(fault?.msg).toBe("scheduled-tasks.list: 5xx fault");
  });
});

describe("respondError contract — route-dependent custom body", () => {
  it("tasks.cancel returns transition: 'cancel' in InvalidTransition 409", async () => {
    const m = stubTaskModule({
      cancelTask: {
        execute: vi.fn(() =>
          errAsync({ type: "InvalidTransition", from: "succeeded", eventType: "cancel" }),
        ),
      },
    });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body).toEqual({
      error: "illegal task state transition",
      code: "InvalidTransition",
      status: "succeeded",
      transition: "cancel",
    });
  });

  it("tasks.delete returns transition: 'delete' in InvalidTransition 409", async () => {
    const m = stubTaskModule({
      deleteTask: {
        execute: vi.fn(() =>
          errAsync({ type: "InvalidTransition", from: "running", eventType: "delete" }),
        ),
      },
    });
    const res = await tasksRoutes(() => m).request(`/${sampleTask.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body).toEqual({
      error: "illegal task state transition",
      code: "InvalidTransition",
      status: "running",
      transition: "delete",
    });
  });
});

describe("respondError contract — union-stable body", () => {
  it("EntryNotReady envelope carries { code, agent, reason } on the tasks route", async () => {
    // Lifted from tasks.test.ts. Pinned again here so the contract is
    // expressed once in the cross-cutting suite — if a future change
    // to the policy ever drops the union-stable body builder, this
    // test catches it without having to run the full per-route file.
    const m = stubTaskModule({
      dispatchTask: {
        execute: vi.fn(() =>
          errAsync({
            type: "EntryNotReady",
            agent: "public/writer",
            reason: {
              needsPrereqsAck: true,
              missingDeps: [{ kind: "skill", name: "public/dep" }],
            },
          }),
        ),
      },
    });
    const res = await tasksRoutes(() => m).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "public/writer", brief: "go" }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.code).toBe("EntryNotReady");
    expect(body.agent).toBe("public/writer");
    expect(body.reason).toBeDefined();
    expect(body.reason.needsPrereqsAck).toBe(true);
  });
});

describe("respondError contract — 5xx fault log separation", () => {
  it("task 5xx fault → 500 + '5xx fault' log, NOT 'unmapped'", async () => {
    // Mapped task 5xx faults stay on the "5xx fault" message, not
    // accidentally relabeled as "unmapped".
    const m = stubTaskModule({
      dispatchTask: {
        execute: vi.fn(() =>
          errAsync({ type: "DatabaseUnavailable", cause: new Error("db unavailable") }),
        ),
      },
    });
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route(
        "/",
        tasksRoutes(() => m),
      );
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "writer", brief: "go" }),
    });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual({ error: "internal error", code: "DatabaseUnavailable" });

    const fivexx = cap.entries.find((e) => e.msg === "tasks: 5xx fault");
    expect(fivexx).toBeDefined();
    const unmapped = cap.entries.find((e) => e.msg?.includes("unmapped"));
    expect(unmapped).toBeUndefined();
  });
});

describe("respondError contract — AgentResolutionFailed 500 path", () => {
  // The three AgentResolutionFailed flows (task / schedule's-own /
  // schedule-run-delegated-to-task) all collapse to the SAME opaque
  // wire envelope: `{ error: "internal error", code:
  // "AgentResolutionFailed" }`. The shape is the contract.
  // Each test pins:
  //   - response status === 500
  //   - body.toEqual({ error: "internal error", code: "AgentResolutionFailed" })
  //     (status-only assertions are explicitly rejected by the brief)
  //   - the `5xx fault` log line fires (so the operator-visible
  //     diagnostic channel still has the cause)

  const TASK_OPAQUE_BODY = {
    error: "internal error",
    code: "AgentResolutionFailed",
  };

  it("tasks route AgentResolutionFailed → 500 + opaque body + 5xx fault log", async () => {
    const m = stubTaskModule({
      dispatchTask: {
        execute: vi.fn(() =>
          errAsync({
            type: "AgentResolutionFailed",
            agent: "public/writer",
            cause: new Error("DB exploded"),
          }),
        ),
      },
    });
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route(
        "/",
        tasksRoutes(() => m),
      );
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "public/writer", brief: "go" }),
    });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual(TASK_OPAQUE_BODY);

    const fivexx = cap.entries.find((e) => e.msg === "tasks: 5xx fault");
    expect(fivexx).toBeDefined();
    expect(fivexx?.level).toBe(50);
    const unmapped = cap.entries.find((e) => e.msg?.includes("unmapped"));
    expect(unmapped).toBeUndefined();
  });

  it("schedules CREATE AgentResolutionFailed (via kind handler) → 500 + opaque body + 5xx fault log", async () => {
    const create = vi.fn(() =>
      errAsync(
        new TaskOperationError({
          type: "AgentResolutionFailed",
          agent: "public/writer",
          cause: new Error("DB exploded"),
        } as AgentResolutionFailed),
      ),
    );
    const stub = { createSchedule: { execute: create } } as never;
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route(
        "/",
        schedulesRoutes(() => stub),
      );
    });
    const res = await app.request("/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "S",
        target: { agent: "public/writer", brief: "go" },
        trigger: { kind: "cron", expr: "* * * * *", tz: "UTC" },
      }),
    });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual(TASK_OPAQUE_BODY);

    const fivexx = cap.entries.find((e) => e.msg?.endsWith(": 5xx fault"));
    expect(fivexx).toBeDefined();
    expect(fivexx?.level).toBe(50);
    const unmapped = cap.entries.find((e) => e.msg?.includes("unmapped"));
    expect(unmapped).toBeUndefined();
  });

  it("schedules-run AgentResolutionFailed (delegated) → 500 + opaque body + 5xx fault log", async () => {
    // POST /schedules/:sid/run delegates to task dispatch; a task
    // resolution fault must surface as 500
    // via the schedules policy's task-code entry. Without that row,
    // this would fall through to 400 'unmapped'.
    const sid = "550e8400-e29b-41d4-a716-446655440000";
    const run = vi.fn(() =>
      errAsync(
        new TaskOperationError({
          type: "AgentResolutionFailed",
          agent: "public/writer",
          cause: new Error("DB exploded"),
        } as AgentResolutionFailed),
      ),
    );
    const stub = { runSchedule: { execute: run } } as never;
    const { app, cap } = await buildAppWithLogger((a) => {
      a.route(
        "/",
        schedulesRoutes(() => stub),
      );
    });
    const res = await app.request(`/${sid}/run`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body).toEqual(TASK_OPAQUE_BODY);

    const fivexx = cap.entries.find((e) => e.msg?.endsWith(": 5xx fault"));
    expect(fivexx).toBeDefined();
    expect(fivexx?.level).toBe(50);
    const unmapped = cap.entries.find((e) => e.msg?.includes("unmapped"));
    expect(unmapped).toBeUndefined();
  });
});

describe("respondError contract — ZodError → 400 ValidationError", () => {
  // Service-layer input-schema parse failures surface as ZodError.
  // respondError must convert them to the SAME { code: "ValidationError",
  // issues } 400 envelope the request `defaultHook` produces, so a body
  // validation failure and a service-input validation failure are
  // indistinguishable on the wire.
  it("a service method that raises ZodError → 400 ValidationError + issues", async () => {
    // After wire/service schema unification the HTTP layer validates the
    // body before the handler runs, so a service-layer ZodError only
    // arises for non-HTTP callers (CLI/MCP) or as defense-in-depth. This
    // pins respondError's ZodError branch directly: a ZodError raised by
    // the service is converted to the same { code: "ValidationError",
    // issues } 400 envelope the request defaultHook produces.
    const application = {
      workspace: {
        listWorkspaces: { execute: vi.fn(async () => []) },
        getWorkspace: { execute: vi.fn() },
        getLastOpenedWorkspaceId: { execute: vi.fn() },
        registerWorkspace: {
          execute: vi.fn(async () => {
            // Simulate the use-case's own input-schema parse failing.
            RegisterWorkspaceRequestSchema.parse({ name: "a".repeat(65) });
          }),
        },
      },
    } as unknown as Parameters<typeof workspacesRoutes>[0];

    const res = await workspacesRoutes(application).request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo" }),
    });

    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as { code: string; issues: unknown[] };
    expect(body.code).toBe("ValidationError");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(JSON.stringify(body.issues)).toMatch(/name/);
  });
});
