/**
 * Devtime helper — assembles the glyph OpenAPI 3.1 application in-process
 * so the codegen pipeline (`generate.ts`) and the smoke test can both
 * fetch the spec / round-trip a request without booting a real listener.
 *
 * This MIRRORS `packages/server/test/openapi-snapshot.test.ts`'s
 * `buildOpenApiAppForTest()` — the same mount tree `runServer` wires,
 * parameterised over throwaway stub resolvers. Doc assembly never invokes
 * a handler, so the stubs (which throw on use) are never called; the
 * health round-trip in the smoke test hits the real `healthRoutes`
 * handler, which has no external deps.
 *
 * Server route factories live behind `@glyphs-ai/server`'s package
 * `exports` fence (only `.` is exported), so they are imported here via
 * cross-package relative SOURCE paths. That is acceptable ONLY because
 * this module lives under `packages/sdk/scripts/**`, which the SDK's
 * runtime-isolation audit explicitly exempts — nothing under
 * `packages/sdk/src/**` may import a workspace package. If the server's
 * mount tree changes, regenerate (`pnpm -F @glyphs-ai/sdk gen`); CI's
 * drift check fails until the committed client matches again.
 */

import type { Application, WorkspaceContext } from "@glyphs-ai/api";
import { workspacesRoutes } from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { CopilotRuntime, RuntimeRegistry } from "@glyphs-ai/runtime";
import type { ScheduleService } from "@glyphs-ai/schedule";
import type { SessionService } from "@glyphs-ai/session";
import type { TaskService } from "@glyphs-ai/task";
import type { WorkflowService } from "@glyphs-ai/workflow";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp, registerOpenApiDoc } from "../../server/src/routes/_openapi.js";
import { catalogRoutes } from "../../server/src/routes/catalog/index.js";
import { configRoutes } from "../../server/src/routes/config.js";
import { healthRoutes } from "../../server/src/routes/health.js";
import { runtimesRoutes } from "../../server/src/routes/runtimes.js";
import { scheduledTasksRoutes } from "../../server/src/routes/scheduled-tasks.js";
import { scheduledWorkflowsRoutes } from "../../server/src/routes/scheduled-workflows.js";
import { schedulesRoutes } from "../../server/src/routes/schedules.js";
import { sessionsRoutes } from "../../server/src/routes/sessions.js";
import { tasksRoutes } from "../../server/src/routes/tasks.js";
import { workflowsRoutes } from "../../server/src/routes/workflows.js";

/**
 * Codegen-only identity for the assembled spec — NOT the runtime `info`.
 *
 * At runtime the real OpenAPI `info` block is supplied by the production
 * `@glyphs-ai/server` boot path; this constant is never read there. It
 * exists solely to give the codegen a stable identity: pinning `version`
 * to `0.0.0` (not the real package version) keeps the generated client's
 * filenames and symbols from churning across release bumps — only the API
 * surface, never the version string, drives a codegen diff. The drift CI
 * job is what catches accidental skew between this constant and what
 * `@glyphs-ai/server` actually emits. Matches the snapshot test's
 * `info.version`.
 */
export const OPENAPI_INFO = { title: "@glyphs-ai/server", version: "0.0.0" } as const;

/** Path the assembled OpenAPI 3.1 document is served from, as in production. */
export const OPENAPI_DOC_PATH = "/api/openapi.json";

/**
 * Build the full OpenAPI app with stub resolvers and the
 * `/api/openapi.json` document endpoint registered. Returns the
 * `OpenAPIHono` instance; callers either `app.request(OPENAPI_DOC_PATH)`
 * for the spec or `app.request("/api/health")` for a live round-trip.
 */
export function buildOpenApiApp(): OpenAPIHono {
  const app = createApiApp();

  app.route(
    "/api/health",
    healthRoutes({ name: OPENAPI_INFO.title, version: OPENAPI_INFO.version, startedAtMs: 0 }),
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
    catalogRoutes(() => stubCatalogFacade()),
  );
  app.route("/api/workspaces", catalogApp);

  registerOpenApiDoc(app, OPENAPI_DOC_PATH, { openapi: "3.1.0", info: { ...OPENAPI_INFO } });

  return app;
}

// ─── Stubs ─────────────────────────────────────────────────────────────
// Throw on use so a future change that accidentally invokes a handler
// during doc assembly surfaces fast. Spec assembly never calls them.

/** A proxy of `T` whose every property access throws — never invoked here. */
function throwingStub<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`${label}: not callable`);
    },
  });
}

function stubApplication(): Application {
  // Two-level: route registration may read `app.<facade>` without invoking
  // it, so property reads yield a (still throw-on-call) stub rather than
  // throwing outright; only actually calling a facade method throws.
  const propStub = throwingStub("stubApplication");
  return new Proxy({} as Application, {
    get() {
      return propStub;
    },
  });
}

function stubSessionManager(): SessionService {
  return throwingStub("stubSessionManager");
}

function stubTaskManager(): TaskService {
  return throwingStub("stubTaskManager");
}

function stubScheduleService(): ScheduleService {
  return throwingStub("stubScheduleService");
}

function stubWorkflowService(): WorkflowService {
  return throwingStub("stubWorkflowService");
}

function stubCatalogFacade(): CatalogService {
  return throwingStub("stubCatalogFacade");
}
