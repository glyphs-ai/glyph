import type { CreateSessionRequest, SpawnSessionResponse, WorkspaceContext } from "@glyphs-ai/api";
import { SessionListQuerySchema, SessionSchema, SpawnSessionResponseSchema } from "@glyphs-ai/api";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { sessionsErrorPolicy } from "./_error-policies/sessions.js";
import { createApiApp, errorResponse, jsonResponse } from "./_openapi.js";
import { respondError } from "./_respond-error.js";
import { isJsonObject, logEvent, parseJsonBody, unknownBodyKey } from "./_shared.js";

/**
 * Resolver passed into `sessionsRoutes` so the routes can pull the
 * workspace-scoped `WorkspaceContext` out of Hono's per-request context
 * (set by the workspace middleware on the parent route).
 *
 * The route accesses `.sessions` for CRUD operations and
 * `.sessions.spawnInteractive()` for the "start an interactive
 * session" call site.
 */
type WorkspaceContextResolver = (c: import("hono").Context) => WorkspaceContext;

type CreateSessionRequestRaw = { [K in keyof CreateSessionRequest]?: unknown };
const SESSION_CREATE_KEYS = new Set(["agent", "runtime"]);
const SESSION_SPAWN_KEYS = new Set(["remote"]);

const SessionPathSchema = z.object({ sid: z.string() });

/**
 * Routes for `/api/workspaces/:id/sessions/*`. Pure transport — every
 * endpoint is parse body → dispatch to the workspace context → format
 * response. The terminal-spawn endpoint delegates to
 * `SessionService.spawnInteractive()` which builds the interactive
 * launch via `runtime.buildInteractiveLaunch` and hands the
 * `LaunchCommand` to the injected terminal spawner (in production,
 * `spawnTerminal` from `@glyphs-ai/terminal`, wired by
 * `composeApplication`).
 */
export function sessionsRoutes(resolve: WorkspaceContextResolver): OpenAPIHono {
  const app = createApiApp();

  // List sessions, optionally filtered by agent / createdSince / activeSince.
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["sessions"],
      summary: "List sessions",
      request: { query: SessionListQuerySchema },
      responses: {
        200: jsonResponse(SessionSchema.array(), "Sessions"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const agent = c.req.query("agent");
      const createdSince = c.req.query("createdSince");
      const activeSince = c.req.query("activeSince");
      // SessionService.list compares ISO timestamps with a plain string
      // `<` (which is correct for `Z`-suffixed ISO 8601 because those sort
      // lexicographically as dates). If we accepted arbitrary
      // Date.parse-able input ("Jan 1 2024") and forwarded it raw, the
      // compare would be wrong. So: parse leniently, forward canonical ISO.
      const canonicalise = (raw: string, label: string): string | { error: string } => {
        const t = Date.parse(raw);
        if (Number.isNaN(t)) return { error: `${label} must be an ISO 8601 timestamp` };
        return new Date(t).toISOString();
      };
      let createdSinceIso: string | undefined;
      if (createdSince !== undefined) {
        const r = canonicalise(createdSince, "createdSince");
        if (typeof r !== "string") return c.json(r, 400);
        createdSinceIso = r;
      }
      let activeSinceIso: string | undefined;
      if (activeSince !== undefined) {
        const r = canonicalise(activeSince, "activeSince");
        if (typeof r !== "string") return c.json(r, 400);
        activeSinceIso = r;
      }
      const opts: { agent?: string; createdSince?: string; activeSince?: string } = {};
      if (agent !== undefined) opts.agent = agent;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (activeSinceIso !== undefined) opts.activeSince = activeSinceIso;
      try {
        return c.json(await resolve(c).sessions.list(opts));
      } catch (err) {
        return respondError(c, err, {
          route: "sessions.list",
          policy: sessionsErrorPolicy,
        });
      }
    },
  );

  // Create a session. `agent` required; `runtime` optional. The body is
  // parsed + validated in the handler (it must return a specific
  // `/JSON/` 400 on a non-`application/json` malformed body, which a
  // zod body validator cannot express — it throws 500 there instead).
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["sessions"],
      summary: "Create a session",
      responses: {
        201: jsonResponse(SessionSchema, "Created session"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const parsed = await parseJsonBody<CreateSessionRequestRaw>(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body;
      if (!isJsonObject(body)) return c.json({ error: "request body must be an object" }, 400);
      const unknown = unknownBodyKey(body, SESSION_CREATE_KEYS);
      if (unknown !== undefined) {
        return c.json({ error: `request body has unknown key "${unknown}"` }, 400);
      }
      if (typeof body.agent !== "string" || body.agent.trim() === "") {
        return c.json({ error: "agent is required (string)" }, 400);
      }
      if (body.runtime !== undefined && typeof body.runtime !== "string") {
        return c.json({ error: "runtime, when present, must be a string" }, 400);
      }
      try {
        const rec = await resolve(c).sessions.create({
          agent: body.agent,
          ...(typeof body.runtime === "string" ? { runtime: body.runtime } : {}),
        });
        logEvent(c, "session created", {
          sessionId: rec.id,
          agent: rec.agent,
          runtime: rec.runtime,
        });
        return c.json(rec, 201);
      } catch (err) {
        return respondError(c, err, {
          route: "sessions",
          policy: sessionsErrorPolicy,
        });
      }
    },
  );

  // Get a single session by id.
  //
  // The path param is `:sid`, not `:id`, to avoid colliding with the
  // outer mount's `/:id/sessions/*` workspace param. When two layers
  // share the same param name, Hono's `c.req.param` returns the outer
  // match; tasks/catalog already use distinct names (`:tid`, `:name`).
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}",
      tags: ["sessions"],
      summary: "Get a session",
      request: { params: SessionPathSchema },
      responses: {
        200: jsonResponse(SessionSchema, "Session"),
        404: errorResponse("Session not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");
      try {
        const rec = await resolve(c).sessions.get(id);
        if (!rec) return c.json({ error: "not found", code: "SessionNotFoundError" }, 404);
        return c.json(rec);
      } catch (err) {
        return respondError(c, err, {
          route: "sessions",
          policy: sessionsErrorPolicy,
          meta: { sessionId: id },
        });
      }
    },
  );

  // Default ("archive"): only the metadata row is removed; workdir +
  // runtime per-session state preserved. `?purge=1` ("hard delete"):
  // row + workdir + runtime state all gone. The query validator is
  // permissive (`purge` as a free string) to preserve the legacy
  // `=== "1"` semantics — any other value is treated as "off", not 400.
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{sid}",
      tags: ["sessions"],
      summary: "Delete a session",
      request: {
        params: SessionPathSchema,
        query: z.object({ purge: z.string().optional() }),
      },
      responses: {
        204: errorResponse("Deleted (no content)"),
        409: errorResponse("Runtime state deletion failed"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");
      const purge = c.req.query("purge") === "1";
      try {
        await resolve(c).sessions.delete(id, { purge });
        logEvent(c, "session deleted", { sessionId: id, purge });
        return c.body(null, 204);
      } catch (err) {
        return respondError(c, err, {
          route: "sessions",
          policy: sessionsErrorPolicy,
          meta: { sessionId: id, purge },
        });
      }
    },
  );

  // One-click launch: build the interactive launch command and hand it
  // to the terminal spawner. Body `{ remote?: boolean }` selects the
  // spawn variant. On any spawn failure the route returns 200 with
  // `{ ok: false, display, ... }` so the dashboard can fall back to a
  // copy-paste command without a second round-trip. The body is parsed
  // in-handler (it is optional — an absent body is valid — which a zod
  // body validator cannot express without throwing on the empty body).
  app.openapi(
    createRoute({
      method: "post",
      path: "/{sid}/spawn",
      tags: ["sessions"],
      summary: "Spawn an interactive terminal for a session",
      request: { params: SessionPathSchema },
      responses: {
        200: jsonResponse(SpawnSessionResponseSchema, "Spawn outcome (ok=false on launch failure)"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Session not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");

      let remote = false;
      if (
        c.req.header("content-length") !== "0" &&
        c.req.header("content-type")?.includes("json")
      ) {
        const parsed = await parseJsonBody<{ remote?: unknown }>(c);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        if (!isJsonObject(parsed.body)) {
          return c.json({ error: "request body must be an object" }, 400);
        }
        const unknown = unknownBodyKey(parsed.body, SESSION_SPAWN_KEYS);
        if (unknown !== undefined) {
          return c.json({ error: `request body has unknown key "${unknown}"` }, 400);
        }
        if (parsed.body.remote === true) remote = true;
        else if (parsed.body.remote !== undefined && parsed.body.remote !== false) {
          return c.json({ error: "`remote`, when present, must be a boolean" }, 400);
        }
      }

      let result: Awaited<ReturnType<WorkspaceContext["sessions"]["spawnInteractive"]>>;
      try {
        result = await resolve(c).sessions.spawnInteractive(id, { remote });
      } catch (err) {
        return respondError(c, err, {
          route: "sessions",
          policy: sessionsErrorPolicy,
          meta: { sessionId: id, remote },
        });
      }

      if (result.ok) {
        logEvent(c, "session spawned", {
          sessionId: id,
          remote,
          launcher: result.launcher,
        });
        return c.json<SpawnSessionResponse>({
          ok: true,
          launcher: result.launcher,
          display: result.display,
        });
      }
      logEvent(c, "session spawn failed", {
        sessionId: id,
        remote,
        code: result.code,
        reason: result.error,
      });
      return c.json<SpawnSessionResponse>({
        ok: false,
        error: result.error,
        code: result.code,
        display: result.display,
      });
    },
  );

  return app;
}
