// Bump libuv's default thread pool from 4 → 16 so concurrent purge
// fs.rm calls and dashboard polls don't queue up behind each other.
// Set BEFORE any other import that uses fs / zlib / crypto worker
// threads (better-sqlite3, pino-roll, hono/node-server). `??=` lets
// operators override via env.
process.env.UV_THREADPOOL_SIZE ??= "16";

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path, { sep as pathSep } from "node:path";
import { composeApplication } from "@glyphs-ai/api";
import {
  assertCopilotSdkResolvable,
  CopilotRuntime,
  RuntimeRegistry,
  sharedDir,
} from "@glyphs-ai/runtime";
import { globalDbPath, workspacesParentDir } from "@glyphs-ai/workspace";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { assertBindIsSafe, isLoopbackBind } from "./auth.js";
import { logsDir, resolveGlyphHome } from "./glyph-home.js";
import { buildLogger, type Logger, type LogLevel } from "./log/build-logger.js";
import { accessLog } from "./middleware/access-log.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { type WorkspaceVars, workspaceContextMiddleware } from "./middleware/workspace-context.js";
import { createApiApp, registerOpenApiDoc } from "./routes/_openapi.js";
import { catalogRoutes } from "./routes/catalog/index.js";
import { configRoutes } from "./routes/config.js";
import { healthRoutes } from "./routes/health.js";
import { runtimesRoutes } from "./routes/runtimes.js";
import { scheduledTasksRoutes } from "./routes/scheduled-tasks.js";
import { scheduledWorkflowsRoutes } from "./routes/scheduled-workflows.js";
import { schedulesRoutes } from "./routes/schedules.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { tasksRoutes } from "./routes/tasks.js";
import { workflowsRoutes } from "./routes/workflows.js";
import { workspacesRoutes } from "./routes/workspaces.js";
import { buildSubprocessEnvBase, SUBPROCESS_ENV_SCRUB_KEYS } from "./subprocess-env.js";

// Route manifest and wire types live in `@glyphs-ai/contracts`,
// re-exported via `@glyphs-ai/api`; CLI and dashboard import them
// directly from api. Server's public surface is strictly its
// transport (`runServer`, `RunServerOpts`) + the auth helpers below
// + the CLI lifecycle breadcrumb helpers (`resolveGlyphHome`,
// `logsDir`, `runtimeFilePath`, the `RuntimeFile` shape) re-exported
// here for the CLI process-management commands (`glyph start`,
// `status`, `stop`, `logs`, `connect`). Those helpers cannot live in
// `@glyphs-ai/contracts` because they value-import `node:os` /
// `node:path`, and the contracts pkg is the SPA-safe surface.
export * from "./glyph-home.js";

/**
 * Per-request variables stashed on the Hono context by `workspaceContextMiddleware`.
 * Both managers point at the same workspace; routes pull whichever they need.
 *
 * The type itself is re-exported via the middleware module so route
 * factories can import it from a single source.
 */

/**
 * Options accepted by {@link runServer}. Every field is optional; unset
 * fields fall back to the corresponding environment variable (see each
 * field's comment for the exact name) and then to the documented default.
 *
 * Lets the CLI's `serve` command (in `@glyphs-ai/cli`), `bin.ts`, and
 * source-mode `pnpm dev` drive the server with structured opts or env / argv.
 */
export interface RunServerOpts {
  /** Override `GLYPH_HOME`. */
  readonly home?: string;
  /** Override `PORT`. Defaults to `8787`. */
  readonly port?: number;
  /** Override `GLYPH_HOST`. Defaults to `"127.0.0.1"`. */
  readonly host?: string;
  /**
   * Serve the dashboard SPA from `staticDir`. Default `false` (dev mode —
   * Vite serves the dashboard separately). The bundled binary's `bin.ts`
   * and the CLI's `serve` command default this to `true` for production.
   */
  readonly serveStatic?: boolean;
  /** Override `GLYPH_STATIC_DIR`. */
  readonly staticDir?: string;
  /** Override `GLYPH_LOG_LEVEL`. Defaults to `"info"`. */
  readonly logLevel?: LogLevel;
  /** Override `GLYPH_LOG_FORMAT`. Defaults to `"pretty"`. */
  readonly logFormat?: "pretty" | "json";
}

/**
 * Pick the dashboard static directory based on layout.
 *
 *   - Bundled binary (`@glyphs-ai/glyph` published to npm): the bundle
 *     lives at `<pkg>/bundle/glyph.js` with assets at `<pkg>/bundle/static/`.
 *     Detect by probing `<dirname>/static/index.html` first.
 *   - Source / monorepo dev: fall back to `packages/dashboard/dist/` two
 *     levels up from `packages/server/dist/`.
 *
 * `GLYPH_STATIC_DIR` always wins if set, for ad-hoc deploys that put the
 * SPA somewhere else.
 */
function resolveStaticDir(serverDir: string): string {
  const beside = path.resolve(serverDir, "static");
  if (existsSync(path.join(beside, "index.html"))) return beside;
  return path.resolve(serverDir, "../../dashboard/dist");
}

/**
 * Boot the glyph HTTP server. Resolves opts → env → default for every
 * tunable, wires the workspace cache, registers routes, and blocks until
 * `SIGTERM` / `SIGINT` triggers graceful shutdown.
 *
 * Direct callers:
 *  - `packages/server/src/bin.ts` — foreground entry, picks up
 *    `--no-serve-static` from argv.
 *  - `packages/cli/src/commands/serve.ts` — `glyph serve` subcommand.
 */
export async function runServer(opts: RunServerOpts = {}): Promise<void> {
  const env = process.env;
  const home = resolveGlyphHome(opts.home !== undefined ? { ...env, GLYPH_HOME: opts.home } : env);

  // `||` instead of `??` so `PORT=""` (common in CI / .env templates with
  // empty values) falls back to the default rather than coercing to 0,
  // which Node treats as "bind to a random ephemeral port" — surprising
  // and almost never what the operator wanted.
  const port = opts.port ?? Number(env.PORT || 8787);
  // Bind to loopback by default — the server exposes destructive endpoints
  // (DELETE /api/workspaces/:id/catalog/skills/:name, etc.) and is intended
  // as a single-user local dashboard. Non-loopback bind is refused at
  // startup (see `assertBindIsSafe` in `auth.ts`). For remote access, expose
  // the loopback socket through SSH port-forward, a reverse proxy, or
  // a mesh VPN — all of which terminate auth at a layer designed for it.
  const hostname = opts.host ?? env.GLYPH_HOST ?? "127.0.0.1";
  const staticDir = opts.staticDir ?? env.GLYPH_STATIC_DIR ?? resolveStaticDir(import.meta.dirname);
  // In source-mode dev, the dashboard is served by Vite on its own port and the
  // server only provides /api. In production (bundled binary) the bin
  // defaults this to true so the SPA is served alongside /api on one port.
  const serveStaticFiles = opts.serveStatic ?? false;

  assertBindIsSafe(hostname);

  // Logger: rotated JSON files under <home>/logs (default) plus stdout
  // for the operator. Level + format honour env so dev can stay pretty
  // and prod can pin JSON-only without code changes.
  const logger: Logger = buildLogger({
    dir: logsDir(home),
    level: opts.logLevel ?? parseLogLevel(env.GLYPH_LOG_LEVEL),
    format: opts.logFormat ?? (env.GLYPH_LOG_FORMAT === "json" ? "json" : "pretty"),
  });

  const runtimeRegistry = new RuntimeRegistry();
  // Fail-fast preflight: confirm `@github/copilot-sdk` (and its
  // transitive `@github/copilot` CLI dep) are resolvable from this
  // process's module graph BEFORE we register the copilot runtime.
  // This keeps SDK resolution failures at startup, before operators
  // can dispatch tasks against a runtime that cannot launch.
  //
  // The thrown `CopilotSdkUnavailableError` carries the install
  // hint and the underlying `ERR_MODULE_NOT_FOUND` chain so the
  // operator sees actionable output on stderr.
  //
  // Pairs with the unmapped-error fall-through logging in
  // `tasks.ts` — the preflight catches the common case at boot;
  // the route-level log catches any residual deep-resolution
  // failure at dispatch time. Together they fully eliminate the
  // silent-failure surface.
  assertCopilotSdkResolvable();
  runtimeRegistry.register(
    new CopilotRuntime({
      // Resolve `${sharedDir}` placeholders in MCP specs against
      // `<GLYPH_HOME>/shared` so spec authors get a stable per-machine
      // directory without baking host paths into JSON.
      sharedDir: sharedDir(home),
      // Runtime owns the cross-cutting env (`GLYPH_SERVER`,
      // `GLYPH_SHARED_DIR`, plus the `GLYPH_HOME` scrub on the
      // headless path) that every spawned agent process inherits.
      // Session / Task add their own work-context env (`GLYPH_WORK_*`,
      // `GLYPH_WORKSPACE*`) on top via the runtime's launchHeadless
      // / buildInteractiveLaunch.
      subprocessEnvBase: buildSubprocessEnvBase({
        hostname,
        port,
        sharedDir: sharedDir(home),
      }),
      subprocessEnvScrub: SUBPROCESS_ENV_SCRUB_KEYS,
    }),
  );

  // Open the workspace registry (`global.db`) via the workspace pkg's
  // composer. The workspace pkg owns the Drizzle init internally, so
  // the server only passes the DB file path. On first launch the
  // composer creates the schema from its own entity list; on
  // subsequent launches `orm.schema.updateSchema()` is a no-op for
  // matching schemas.
  //
  // We do NOT auto-create a default workspace — the dashboard's
  // landing page prompts the user to create one explicitly.
  await mkdir(home, { recursive: true });

  const composition = await composeApplication({
    workspace: { dbFile: globalDbPath(home) },
    runtimeRegistry,
    defaultWorkspaceParent: workspacesParentDir(home),
    logger,
  });
  logger.info({ file: globalDbPath(home) }, "global.db opened via workspace pkg");

  const workspaceService = composition.workspaceService;
  const application = composition;

  const app = new OpenAPIHono();

  // Observability middleware chain. Order matters:
  //   1. requestId      — mints/honours x-request-id header
  //   2. requestLogger  — builds a pino child bound to { requestId }
  //                       and stashes it on c.var.logger
  //   3. accessLog      — emits one structured info/warn/error line per
  //                       request at end-of-request
  // Mounted globally so /api/health and unauth requests still produce
  // an access line. accessLog skips /api/health internally to keep the
  // poll-loop noise down.
  app.use("*", requestId());
  app.use("*", requestLogger(logger));
  app.use("*", accessLog());

  // /api/health stays unauthenticated so the dashboard's backoff probe
  // and external liveness checks can poll it. glyph delegates auth to
  // the operator's reverse proxy / SSH tunnel / mesh VPN — see auth.ts.
  // The endpoint exposes only liveness and clock fields: `status`,
  // `name`, `version`, `startedAt`, `uptimeSec`, and `serverNow` —
  // nothing a network observer couldn't already derive from the
  // running socket.
  const { name: serverName, version: serverVersion } = await readServerPackageMeta();
  const startedAtMs = Date.now();
  app.route(
    "/api/health",
    healthRoutes({
      name: serverName,
      version: serverVersion,
      startedAtMs,
    }),
  );

  app.route(
    "/api/config",
    configRoutes({
      glyphHome: home,
      host: hostname,
      port,
      pathSeparator: pathSep,
      currentWorkspaceId: () => workspaceService.getLastOpenedId(),
    }),
  );
  app.route("/api/runtimes", runtimesRoutes(runtimeRegistry));
  app.route("/api/workspaces", workspacesRoutes(application));

  // Workspace-scoped sessions / tasks / catalog. Middleware resolves the
  // `:id` workspace once and stashes the whole `WorkspaceContext` on
  // c.var; each route family reads the bits it needs. 404 if id is not
  // registered; 5xx if workspace.db cannot be opened.
  const sessionsApp = createApiApp<{ Variables: WorkspaceVars }>();
  sessionsApp.use("/:id/sessions/*", workspaceContextMiddleware(application, logger));
  sessionsApp.route(
    "/:id/sessions",
    sessionsRoutes((c) => c.get("workspaceContext")),
  );
  app.route("/api/workspaces", sessionsApp);

  const tasksApp = createApiApp<{ Variables: WorkspaceVars }>();
  tasksApp.use("/:id/tasks/*", workspaceContextMiddleware(application, logger));
  tasksApp.route(
    "/:id/tasks",
    tasksRoutes((c) => c.get("workspaceContext").tasks),
  );
  app.route("/api/workspaces", tasksApp);

  // `/scheduled-tasks` is the schedule-origin sibling of `/tasks`. It
  // shares the same workspace-scoped TaskService (via the same
  // `workspaceContext.tasks` resolver) so storage / cancellation /
  // dispatch all observe one in-memory state — splitting at the route
  // layer, not the service layer, keeps the seam at the URL where it
  // belongs.
  const scheduledTasksApp = createApiApp<{ Variables: WorkspaceVars }>();
  scheduledTasksApp.use("/:id/scheduled-tasks/*", workspaceContextMiddleware(application, logger));
  scheduledTasksApp.route(
    "/:id/scheduled-tasks",
    scheduledTasksRoutes((c) => c.get("workspaceContext").tasks),
  );
  app.route("/api/workspaces", scheduledTasksApp);

  // `/scheduled-workflows` is the schedule-origin sibling of
  // `/workflows`. Returns workflows launched by cron triggers,
  // filtered by `metadata.scheduleId`.
  const scheduledWorkflowsApp = createApiApp<{ Variables: WorkspaceVars }>();
  scheduledWorkflowsApp.use(
    "/:id/scheduled-workflows/*",
    workspaceContextMiddleware(application, logger),
  );
  scheduledWorkflowsApp.route(
    "/:id/scheduled-workflows",
    scheduledWorkflowsRoutes((c) => c.get("workspaceContext").workflows),
  );
  app.route("/api/workspaces", scheduledWorkflowsApp);

  // Schedule CRUD + run + preview. Sibling of `/scheduled-tasks` —
  // that route is read-only over the dispatched task list; this
  // route owns the trigger entities themselves. Both share the same
  // workspace-scoped per-context state via the middleware.
  const schedulesApp = createApiApp<{ Variables: WorkspaceVars }>();
  schedulesApp.use("/:id/schedules/*", workspaceContextMiddleware(application, logger));
  schedulesApp.route(
    "/:id/schedules",
    schedulesRoutes(
      (c) => c.get("workspaceContext").schedules,
      (c) => c.get("workspaceContext").workflows,
    ),
  );
  app.route("/api/workspaces", schedulesApp);

  // Workflow read + lifecycle surface. The substrate is kind-agnostic
  // and stores nodes as `{ kind, spec: unknown }`; the wire-layer
  // projection in `routes/_workflow-projection.ts` flattens the
  // per-kind shapes for the dashboard / CLI.
  const workflowsApp = createApiApp<{ Variables: WorkspaceVars }>();
  workflowsApp.use("/:id/workflows/*", workspaceContextMiddleware(application, logger));
  workflowsApp.route(
    "/:id/workflows",
    workflowsRoutes(
      (c) => c.get("workspaceContext").workflows,
      (c) => c.get("workspaceContext").tasks,
      (c) => c.get("workspaceContext").workspace.workspaceDir,
    ),
  );
  app.route("/api/workspaces", workflowsApp);

  const catalogApp = createApiApp<{ Variables: WorkspaceVars }>();
  catalogApp.use("/:id/catalog/*", workspaceContextMiddleware(application, logger));
  catalogApp.route(
    "/:id/catalog",
    catalogRoutes((c) => c.get("workspaceContext").catalog),
  );
  app.route("/api/workspaces", catalogApp);

  // OpenAPI: assemble the 3.1 document from every mounted OpenAPIHono
  // sub-app, inject the mount-level workspace `id` params, and serve it,
  // plus a Swagger UI page. Registered after all route families (so the
  // spec carries every operation) and before the static/SPA fallback (so
  // `/api/docs` and `/api/openapi.json` are not shadowed by the catch-all
  // GET handler below).
  registerOpenApiDoc(app, "/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: serverName, version: serverVersion },
  });
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

  if (serveStaticFiles) {
    app.use("/*", serveStatic({ root: staticDir }));
    // SPA history fallback: any non-API GET that didn't resolve to a
    // static asset (i.e. a deep route like /workspaces/<uuid>/catalog)
    // should hand back index.html so client-side React Router can take
    // over. Hono walks middleware in registration order and only reaches
    // this handler if the static layer above produced no match.
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      const indexPath = path.join(staticDir, "index.html");
      try {
        const fs = await import("node:fs/promises");
        const html = await fs.readFile(indexPath, "utf8");
        return c.html(html);
      } catch {
        return next();
      }
    });
  }

  const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;
  const wsList = await workspaceService.list();
  logger.info(
    {
      listen: `http://${displayHost}:${port}`,
      home: home,
      globalDb: globalDbPath(home),
      workspaces: wsList.length,
      runtimes: runtimeRegistry.kinds(),
      static: serveStaticFiles ? staticDir : null,
      logsDir: logsDir(home),
    },
    "glyph server starting",
  );
  if (!isLoopbackBind(hostname)) {
    logger.warn(
      { host: hostname },
      "server is reachable from the network; glyph does not ship its own auth — terminate auth at a reverse proxy",
    );
  }
  const server = serve({ fetch: app.fetch, port, hostname });

  // Fire-and-forget pre-warm. Every registered workspace gets a
  // load() kicked off in the background so its per-workspace
  // schedule-task timer arms (see `scheduleModule.service.recover()`
  // inside `WorkspaceContextRegistry.load()`). Without this, a
  // workspace whose dashboard / CLI never touched its routes would
  // silently never fire its scheduled tasks.
  //
  // We deliberately do NOT await Promise.all — with N workspaces and
  // a ~500ms per-workspace cold load, blocking listener startup on
  // the full fan-out becomes N × 500ms (50s at N=100). The HTTP
  // listener is up before this loop starts; in-flight cold-load
  // requests are handled by the 202 / 503 protocol in
  // `workspaceContextMiddleware`.
  if (wsList.length > 0) {
    const prewarmStart = performance.now();
    logger.info({ count: wsList.length }, "pre-warming workspace contexts (background)");
    let remaining = wsList.length;
    for (const ws of wsList) {
      application.getContext(ws.id).then(
        () => {
          remaining -= 1;
          if (remaining === 0) {
            const elapsedMs = Math.round(performance.now() - prewarmStart);
            logger.info({ count: wsList.length, elapsedMs }, "workspace pre-warm complete");
          }
        },
        (err: unknown) => {
          remaining -= 1;
          // Log enough to triage without spamming stack frames into
          // every metrics scraper. Lazy retry continues to surface
          // through the middleware's 503 envelope on next access.
          logger.error(
            { err, workspaceId: ws.id, workspaceName: ws.name },
            "workspace pre-warm failed; scheduled tasks for this workspace will not fire until next attempted access succeeds",
          );
          if (remaining === 0) {
            const elapsedMs = Math.round(performance.now() - prewarmStart);
            logger.info(
              { count: wsList.length, elapsedMs },
              "workspace pre-warm complete (with failures)",
            );
          }
        },
      );
    }
  }

  // Graceful shutdown: kill every in-flight task subprocess and wait for
  // the post-exit persistence to finish, so the dashboard sees consistent
  // failure-reason="server shutdown" rows on next start (rather than
  // ghost "running" entries waiting for orphan recovery).
  //
  // Ordering:
  //   1. `server.close()` first — stops accepting new connections and
  //      waits for in-flight HTTP to drain. This prevents two races:
  //      (a) a `POST /tasks` arriving mid-shutdown spawning a new
  //      subprocess after we've already taken the snapshot, and (b) the
  //      first request to a workspace whose context wasn't loaded yet
  //      lazy-instantiating a fresh TaskService that wasn't in
  //      `application.loadedContexts()` and would never get drained.
  //   2. `tasks.shutdown()` second — by now no new dispatches can land,
  //      so the snapshot of cached contexts is authoritative.
  //
  // Timeout: 30s. Anything still alive after that gets process.exit(1)
  // so a wedged subprocess can't pin the deploy host indefinitely.
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown initiated");
    const deadline = setTimeout(() => {
      logger.error("shutdown timed out after 30s; forcing exit");
      process.exit(1);
    }, 30_000);
    deadline.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        // @hono/node-server's `serve` returns a node http.Server, which
        // has a standard `close(cb)`. Stop accepting new connections,
        // then wait for in-flight ones to drain.
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      logger.error({ err }, "error closing http server");
    }
    try {
      const ctxs = application.loadedContexts();
      await Promise.allSettled(ctxs.map((ctx) => ctx.tasks.shutdown()));
    } catch (err) {
      logger.error({ err }, "error during tasks shutdown");
    }
    try {
      // Close the workspace registry's underlying Drizzle DB handle
      // (`global.db`) plus every per-workspace SQLite handle via
      // `application.close()` (composes the internal context
      // registry's `closeAll()` then the global handle). Releasing
      // the SQLite files is required on Windows where `unlink`
      // refuses to remove files with open handles (the CLI
      // integration tests `rm -rf <GLYPH_HOME>` immediately after
      // `stop`, and an unclosed `workspace.db` surfaces as `EBUSY:
      // resource busy or locked`).
      await application.close();
    } catch (err) {
      logger.error({ err }, "error closing global.db");
    }
    clearTimeout(deadline);
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
}

/**
 * Parse the `GLYPH_LOG_LEVEL` env into one of pino's six supported
 * levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). Falls
 * back to `"info"` on any unrecognised / unset value so a misconfigured
 * env never silently disables logging.
 */
function parseLogLevel(raw: string | undefined): LogLevel {
  switch (raw) {
    case "trace":
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "fatal":
      return raw;
    default:
      return "info";
  }
}

/**
 * Read this server package's `package.json` to surface its name + version
 * via `/api/health`. We resolve relative to `import.meta.url` so the
 * lookup works whether the server runs from `dist/` (production build)
 * or `src/` (tsx dev mode). Failures degrade gracefully — health stays
 * up with placeholder strings rather than crashing the boot.
 */
async function readServerPackageMeta(): Promise<{ name: string; version: string }> {
  // dist/index.js → ../package.json; src/index.ts (via tsx) → ../package.json
  const pkgFile = path.resolve(import.meta.dirname, "..", "package.json");
  try {
    const raw = await readFile(pkgFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name : "@glyphs-ai/server";
    const version = typeof parsed.version === "string" ? parsed.version : "0.0.0-unknown";
    return { name, version };
  } catch {
    // If we cannot read our own package.json (unusual: bundler stripped
    // it, fs perms wonky), fall back to placeholders so /api/health still
    // serves liveness probes.
    return { name: "@glyphs-ai/server", version: "0.0.0-unknown" };
  }
}
