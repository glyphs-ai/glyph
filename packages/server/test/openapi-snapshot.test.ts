/**
 * OpenAPI spec snapshot test.
 *
 * Mirrors `runServer`'s mount tree (see `../src/index.ts`) on a
 * throwaway `OpenAPIHono` app with stub resolvers, assembles the
 * OpenAPI 3.1 document the same way `GET /api/openapi.json` does, and
 * pins it against a committed snapshot. Any change to a route's
 * method / path / params / request body / response schema surfaces as
 * a snapshot diff that CI fails on unless the snapshot is updated in
 * the same commit.
 *
 * `info.version` is pinned to `0.0.0` (rather than the real package
 * version) so the snapshot is stable across release bumps — only the
 * API surface, never the version string, drives the diff.
 */

import type { Application, WorkspaceContext } from "@glyphs-ai/api";
import { catalogRoutes, workspacesRoutes } from "@glyphs-ai/api";
import type { CatalogModule } from "@glyphs-ai/catalog";
import { CopilotRuntime, RuntimeRegistry } from "@glyphs-ai/runtime";
import type { ScheduleService } from "@glyphs-ai/schedule";
import type { SessionService } from "@glyphs-ai/session";
import type { TaskService } from "@glyphs-ai/task";
import type { WorkflowService } from "@glyphs-ai/workflow";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
  createApiApp,
  injectWorkspaceIdParam,
  registerOpenApiDoc,
} from "../src/routes/_openapi.js";
import { configRoutes } from "../src/routes/config.js";
import { healthRoutes } from "../src/routes/health.js";
import { runtimesRoutes } from "../src/routes/runtimes.js";
import { scheduledTasksRoutes } from "../src/routes/scheduled-tasks.js";
import { scheduledWorkflowsRoutes } from "../src/routes/scheduled-workflows.js";
import { schedulesRoutes } from "../src/routes/schedules.js";
import { sessionsRoutes } from "../src/routes/sessions.js";
import { tasksRoutes } from "../src/routes/tasks.js";
import { workflowsRoutes } from "../src/routes/workflows.js";

/**
 * Mirror of `runServer`'s mount tree, parameterised over deps so the
 * test can pass throwaway stubs. Doc assembly never invokes a handler,
 * so the stub resolvers (which throw on use) are never called.
 */
function buildOpenApiAppForTest(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.route(
    "/api/health",
    healthRoutes({ name: "@glyphs-ai/server", version: "0.0.0", startedAtMs: 0 }),
  );

  app.route(
    "/api/config",
    configRoutes({
      glyphHome: "/tmp",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      currentWorkspaceId: () => null,
    }),
  );

  const runtimeRegistry = new RuntimeRegistry();
  runtimeRegistry.register(new CopilotRuntime({ sharedDir: "/tmp/shared" }));
  app.route("/api/runtimes", runtimesRoutes(runtimeRegistry));

  app.route("/api/workspaces", workspacesRoutes(stubApplication()));

  const sessionsApp = createApiApp();
  sessionsApp.route(
    "/:id/sessions",
    sessionsRoutes(() => ({ sessions: stubSessionManager() }) as unknown as WorkspaceContext),
  );
  app.route("/api/workspaces", sessionsApp);

  const tasksApp = createApiApp();
  tasksApp.route(
    "/:id/tasks",
    tasksRoutes(() => stubTaskManager()),
  );
  app.route("/api/workspaces", tasksApp);

  const scheduledTasksApp = createApiApp();
  scheduledTasksApp.route(
    "/:id/scheduled-tasks",
    scheduledTasksRoutes(() => stubTaskManager()),
  );
  app.route("/api/workspaces", scheduledTasksApp);

  const scheduledWorkflowsApp = createApiApp();
  scheduledWorkflowsApp.route(
    "/:id/scheduled-workflows",
    scheduledWorkflowsRoutes(() => stubWorkflowService()),
  );
  app.route("/api/workspaces", scheduledWorkflowsApp);

  const schedulesApp = createApiApp();
  schedulesApp.route(
    "/:id/schedules",
    schedulesRoutes(
      () => stubScheduleService(),
      () => stubWorkflowService(),
    ),
  );
  app.route("/api/workspaces", schedulesApp);

  const workflowsApp = createApiApp();
  workflowsApp.route(
    "/:id/workflows",
    workflowsRoutes(
      () => stubWorkflowService(),
      () => stubTaskManager(),
      () => "C:\\stub\\workspace",
    ),
  );
  app.route("/api/workspaces", workflowsApp);

  const catalogApp = createApiApp();
  catalogApp.route(
    "/:id/catalog",
    catalogRoutes(() => stubCatalogModule()),
  );
  app.route("/api/workspaces", catalogApp);

  return app;
}

describe("openapi spec", () => {
  it("assembled /api/openapi.json matches the committed snapshot", () => {
    const app = buildOpenApiAppForTest();
    const doc = injectWorkspaceIdParam(
      app.getOpenAPI31Document({
        openapi: "3.1.0",
        info: { title: "@glyphs-ai/server", version: "0.0.0" },
      }),
    );
    expect(doc).toMatchSnapshot();
  });

  it("GET /api/openapi.json serves the assembled 3.1 document", async () => {
    const app = buildOpenApiAppForTest();
    registerOpenApiDoc(app, "/api/openapi.json", {
      openapi: "3.1.0",
      info: { title: "@glyphs-ai/server", version: "0.0.0" },
    });
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/health"]).toBeDefined();
    // The mount-level workspace `id` is injected into every nested
    // operation's parameters (see `injectWorkspaceIdParam`).
    const nested = doc.paths["/api/workspaces/{id}/workflows"]?.get;
    expect(nested?.parameters?.some((p) => p.name === "id" && p.in === "path")).toBe(true);
  });

  it("GET /api/docs serves Swagger UI", async () => {
    const app = buildOpenApiAppForTest();
    registerOpenApiDoc(app, "/api/openapi.json", {
      openapi: "3.1.0",
      info: { title: "@glyphs-ai/server", version: "0.0.0" },
    });
    app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
    const res = await app.request("/api/docs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("swagger-ui");
  });
});

// ─── Stubs ─────────────────────────────────────────────────────────────
// All stubs throw on use so accidentally invoking a handler in a future
// test surfaces fast. Doc assembly never calls them.

function stubApplication(): Application {
  const propStub = new Proxy(
    {},
    {
      get() {
        throw new Error("stubApplication: not callable");
      },
    },
  );
  return new Proxy({} as Application, {
    get() {
      return propStub;
    },
  });
}

function stubSessionManager(): SessionService {
  return new Proxy({} as SessionService, {
    get() {
      throw new Error("stubSessionManager: not callable");
    },
  });
}

function stubTaskManager(): TaskService {
  return new Proxy({} as TaskService, {
    get() {
      throw new Error("stubTaskManager: not callable");
    },
  });
}

function stubScheduleService(): ScheduleService {
  return new Proxy({} as ScheduleService, {
    get() {
      throw new Error("stubScheduleService: not callable");
    },
  });
}

function stubWorkflowService(): WorkflowService {
  return new Proxy({} as WorkflowService, {
    get() {
      throw new Error("stubWorkflowService: not callable");
    },
  });
}

function stubCatalogModule(): CatalogModule {
  return new Proxy({} as CatalogModule, {
    get() {
      throw new Error("stubCatalogModule: not callable");
    },
  });
}
