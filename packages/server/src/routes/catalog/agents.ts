import {
  AgentEntrySchema,
  AgentSchema,
  AgentWithContentSchema,
  AnchorResponseSchema,
  CatalogFileEntrySchema,
  CatalogInstallResultSchema,
  CatalogSyncResultSchema,
  InstallAgentRequestSchema,
  OkResponseSchema,
  ResolveManifestSchema,
  SyncCatalogRequestSchema,
} from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_openapi.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { mimeFromExt } from "./mime.js";
import { planToManifest } from "./plan-to-manifest.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";

/**
 * Routes for /agents/* relative to the parent mount. Mirrors
 * {@link skillsRoutes}: takes a body `{ origin }`, performs
 * `installAgent` (resolve + apply), returns a `CatalogInstallResult`.
 *
 * `POST /resolve` returns the read-only `CatalogPlan` for the
 * dashboard's two-phase install flow.
 *
 * Status mapping + body shaping flows through `respondError` against
 * `catalogErrorPolicy`. Catalog routes inherit the policy's
 * `defaultStatus: 500` — unknown catalog errors are server faults, not
 * caller-fixable 400s.
 */
export function agentsRoutes(arg: CatalogResolver | CatalogService): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List agent entries",
      responses: {
        200: jsonResponse(AgentEntrySchema.array(), "Agent entries"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => c.json(await getCatalog(c).listAgentEntries()),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/resolve",
      tags: ["catalog"],
      summary: "Preview an agent install",
      request: { body: jsonRequest(InstallAgentRequestSchema) },
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await catalog.resolveAgentFromOrigin(body.origin);
        return c.json(planToManifest(plan));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.resolve",
          policy: catalogErrorPolicy,
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{scope}/{name}/anchor",
      tags: ["catalog"],
      summary: "Get an agent's anchor content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(AnchorResponseSchema, "Anchor content"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const content = await catalog.getAgentContent(fqn);
        return c.json({ content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.anchor",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{scope}/{name}/files",
      tags: ["catalog"],
      summary: "List an agent's files, or read one file's bytes",
      request: {
        params: z.object({ scope: z.string().min(1), name: z.string().min(1) }),
        query: z.object({ path: z.string().optional() }),
      },
      responses: {
        200: jsonResponse(
          CatalogFileEntrySchema.array(),
          "File entries, or raw file bytes when ?path= is set",
        ),
        404: errorResponse("File not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      // `?path=` selects a single file to stream (bytes); its absence
      // lists the entry's files. The file path rides as a query param,
      // not a path segment, because it is itself slash-bearing and of
      // arbitrary depth — which a single `{name}` segment can't carry.
      const rawPath = c.req.query("path");
      if (rawPath !== undefined) {
        let relPath = rawPath;
        try {
          relPath = decodeURIComponent(rawPath);
          const buf = await catalog.getAgentFile(fqn, relPath);
          if (buf === null) return c.json({ error: "not found", code: "NotFound" }, 404);
          const ab = new ArrayBuffer(buf.byteLength);
          new Uint8Array(ab).set(buf);
          return new Response(ab, {
            headers: { "Content-Type": mimeFromExt(relPath) },
          });
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.agents.files.get",
            policy: catalogErrorPolicy,
            meta: { fqn, relPath },
          });
        }
      }
      try {
        const files = await catalog.listAgentFiles(fqn);
        return c.json(files);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.files.list",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{scope}/{name}",
      tags: ["catalog"],
      summary: "Get an agent with content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(AgentWithContentSchema, "Agent with content"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const entry = await catalog.getAgentEntry(fqn);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getAgentContent(fqn);
        return c.json({ ...entry, content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.get",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["catalog"],
      summary: "Install an agent from an origin",
      request: { body: jsonRequest(InstallAgentRequestSchema) },
      responses: {
        201: jsonResponse(CatalogInstallResultSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const result = await catalog.installAgent(body.origin);
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: agent install completed", {
          kind: "agent",
          origin: body.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.install",
          policy: catalogErrorPolicy,
          meta: { origin: body.origin },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/sync/resolve",
      tags: ["catalog"],
      summary: "Preview an agent sync",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        // resolveSyncAgent stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await catalog.resolveSyncAgent(fqn);
        const planToken = catalog.cachePlan(plan);
        return c.json(planToManifest(plan, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync.resolve",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/sync",
      tags: ["catalog"],
      summary: "Apply an agent sync",
      request: {
        params: z.object({ scope: z.string().min(1), name: z.string().min(1) }),
        body: jsonRequest(SyncCatalogRequestSchema),
      },
      responses: {
        200: jsonResponse(CatalogSyncResultSchema, "Sync result"),
        400: errorResponse("Malformed request body"),
        410: errorResponse("Plan token expired or already applied"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      const plan = catalog.takePlan(body.planToken);
      if (plan === null) {
        return c.json(
          {
            error: "preview expired or already applied; re-preview to continue",
            code: "PlanTokenInvalid",
          },
          410,
        );
      }
      try {
        const result = await catalog.applySync(plan);
        const status = result.failed.length > 0 ? 207 : 200;
        logEvent(c, "catalog: agent sync applied", {
          kind: "agent",
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync",
          policy: catalogErrorPolicy,
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/acknowledge-prereqs",
      tags: ["catalog"],
      summary: "Acknowledge an agent's prereqs",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await catalog.acknowledgeAgentPrereqs(fqn);
        logEvent(c, "catalog: agent prereqs acknowledged", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.acknowledgePrereqs",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/disable",
      tags: ["catalog"],
      summary: "Disable an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await catalog.disableAgent(fqn);
        logEvent(c, "catalog: agent disabled", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.disable",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/enable",
      tags: ["catalog"],
      summary: "Enable an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await catalog.enableAgent(fqn);
        logEvent(c, "catalog: agent enabled", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.enable",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{scope}/{name}",
      tags: ["catalog"],
      summary: "Delete an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(OkResponseSchema, "Deleted"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        await catalog.deleteAgent(fqn);
        logEvent(c, "catalog: agent removed", { kind: "agent", fqn });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.delete",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  return app;
}
