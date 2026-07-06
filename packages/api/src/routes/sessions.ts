import {
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  GetSessionResponseSchema,
  ListSessionsRequestSchema,
  ListSessionsResponseSchema,
  type SessionId,
  SpawnInteractiveRequestSchema,
  type SpawnInteractiveResponse,
  SpawnInteractiveResponseSchema,
} from "@glyphs-ai/session";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { respondSessionError } from "../_error-policies/sessions.js";
import { logEvent, problemResponse } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import type { WorkspaceContext } from "../workspace-context.js";

/**
 * Resolver passed into `sessionsRoutes` so the routes can pull the
 * workspace-scoped `WorkspaceContext` out of Hono's per-request context
 * (set by the workspace middleware on the parent route). Each handler
 * dispatches to `ctx.sessions.<useCase>.execute(...)` and renders the
 * `Result` — DU errors via {@link respondSessionError}, malformed path
 * ids as the 400 `ZodError` thrown by the use-case's request re-parse.
 */
type WorkspaceContextResolver = (c: import("hono").Context) => WorkspaceContext;

const SessionPathSchema = z.object({ sid: z.string() });

/**
 * Routes for `/api/workspaces/:id/sessions/*`. Pure transport — every
 * endpoint is parse → dispatch to the session use-case → format the
 * `Result`. The terminal-spawn endpoint runs `spawnInteractive`, which
 * builds the launch via the runtime and hands the `LaunchCommand` to
 * the injected spawner (`@glyphs-ai/terminal`'s `localSpawner` in
 * production).
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
      request: { query: ListSessionsRequestSchema },
      responses: {
        200: jsonResponse(ListSessionsResponseSchema, "Sessions"),
        400: errorResponse("Malformed query"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const agent = c.req.query("agent");
      const createdSince = c.req.query("createdSince");
      const activeSince = c.req.query("activeSince");
      // `listSessions` compares ISO timestamps with a plain string `<`
      // (correct for `Z`-suffixed ISO 8601, which sorts lexicographically
      // as dates). Accepting arbitrary Date.parse-able input and forwarding
      // it raw would break that compare, so parse leniently here and
      // forward canonical ISO.
      const canonicalise = (raw: string, label: string): string | { detail: string } => {
        const t = Date.parse(raw);
        if (Number.isNaN(t)) return { detail: `${label} must be an ISO 8601 timestamp` };
        return new Date(t).toISOString();
      };
      let createdSinceIso: string | undefined;
      if (createdSince !== undefined) {
        const r = canonicalise(createdSince, "createdSince");
        if (typeof r !== "string")
          return problemResponse(c, 400, { code: "BadRequest", detail: r.detail });
        createdSinceIso = r;
      }
      let activeSinceIso: string | undefined;
      if (activeSince !== undefined) {
        const r = canonicalise(activeSince, "activeSince");
        if (typeof r !== "string")
          return problemResponse(c, 400, { code: "BadRequest", detail: r.detail });
        activeSinceIso = r;
      }
      const opts: { agent?: string; createdSince?: string; activeSince?: string } = {};
      if (agent !== undefined) opts.agent = agent;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (activeSinceIso !== undefined) opts.activeSince = activeSinceIso;
      const res = await resolve(c).sessions.listSessions.execute(opts);
      return res.match(
        (list) => c.json(list),
        (err) => respondSessionError(c, err, { route: "sessions.list" }),
      );
    },
  );

  // Create a session. `agent` required (non-empty); `runtime` optional.
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["sessions"],
      summary: "Create a session",
      request: { body: jsonRequest(CreateSessionRequestSchema) },
      responses: {
        201: jsonResponse(CreateSessionResponseSchema, "Created session"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const res = await resolve(c).sessions.createSession.execute({
        agent: body.agent,
        ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
      });
      return res.match(
        (rec) => {
          logEvent(c, "session created", {
            sessionId: rec.id,
            agent: rec.agent,
            runtime: rec.runtime,
          });
          return c.json(rec, 201);
        },
        (err) => respondSessionError(c, err, { route: "sessions.create" }),
      );
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
        200: jsonResponse(GetSessionResponseSchema, "Session"),
        404: errorResponse("Session not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");
      const res = await resolve(c).sessions.getSession.execute({ id: id as SessionId });
      return res.match(
        (rec) => {
          if (!rec)
            return problemResponse(c, 404, {
              code: "SessionNotFound",
              detail: "session not found",
            });
          return c.json(rec);
        },
        (err) => respondSessionError(c, err, { route: "sessions.get", meta: { sessionId: id } }),
      );
    },
  );

  // Default ("archive"): only the metadata row is removed; workdir +
  // runtime per-session state preserved. `?purge=1` ("hard delete"):
  // row + workdir + runtime state all gone. The query validator is
  // permissive (`purge` as a free string) so only the exact value `"1"`
  // enables purge — any other value is treated as "off", not 400.
  // Delete is idempotent: an already-absent session still returns 204.
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
        400: errorResponse("Unknown runtime"),
        409: errorResponse("Runtime state / workdir removal failed"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");
      const purge = c.req.query("purge") === "1";
      const res = await resolve(c).sessions.deleteSession.execute({ id: id as SessionId, purge });
      return res.match(
        () => {
          logEvent(c, "session deleted", { sessionId: id, purge });
          return c.body(null, 204);
        },
        (err) => {
          if (err.type === "SessionNotFound") return c.body(null, 204);
          return respondSessionError(c, err, {
            route: "sessions.delete",
            meta: { sessionId: id, purge },
          });
        },
      );
    },
  );

  // One-click launch: build the interactive launch command and hand it
  // to the terminal spawner. Body `{ remote?: boolean }` is optional —
  // an absent body defaults `remote` to false. On any spawn failure the
  // route returns 200 with `{ ok: false, display, ... }` so the
  // dashboard can fall back to a copy-paste command without a second
  // round-trip.
  app.openapi(
    createRoute({
      method: "post",
      path: "/{sid}/spawn",
      tags: ["sessions"],
      summary: "Spawn an interactive terminal for a session",
      request: {
        params: SessionPathSchema,
        body: jsonRequest(SpawnInteractiveRequestSchema.omit({ id: true }).strict(), false),
      },
      responses: {
        200: jsonResponse(
          SpawnInteractiveResponseSchema,
          "Spawn outcome (ok=false on launch failure)",
        ),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("sid");
      const body = c.req.valid("json");
      const remote = body?.remote === true;
      const res = await resolve(c).sessions.spawnInteractive.execute({
        id: id as SessionId,
        ...(remote ? { remote: true } : {}),
      });
      return res.match(
        (outcome) => {
          if (outcome.ok) {
            logEvent(c, "session spawned", { sessionId: id, remote, launcher: outcome.launcher });
            return c.json<SpawnInteractiveResponse>({
              ok: true,
              launcher: outcome.launcher,
              display: outcome.display,
            });
          }
          logEvent(c, "session spawn failed", {
            sessionId: id,
            remote,
            code: outcome.code,
            reason: outcome.error,
          });
          return c.json<SpawnInteractiveResponse>({
            ok: false,
            error: outcome.error,
            code: outcome.code,
            display: outcome.display,
          });
        },
        (err) =>
          respondSessionError(c, err, { route: "sessions.spawn", meta: { sessionId: id, remote } }),
      );
    },
  );

  return app;
}
