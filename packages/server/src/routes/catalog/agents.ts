import {
  AgentEntrySchema,
  AgentSchema,
  AgentWithContentSchema,
  AnchorResponseSchema,
  CatalogFileEntrySchema,
  CatalogInstallResultSchema,
  CatalogSyncResultSchema,
  OkResponseSchema,
  ResolveManifestSchema,
} from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { createApiApp, errorResponse, jsonResponse } from "../_openapi.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readInstallAgentRequest, readPlanToken } from "./helpers.js";
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
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readInstallAgentRequest(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const plan = await catalog.resolveAgentFromOrigin(parsed.origin);
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
      path: "/{name{.+}}/anchor",
      tags: ["catalog"],
      summary: "Get an agent's anchor content",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(AnchorResponseSchema, "Anchor content"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const content = await catalog.getAgentContent(name);
        return c.json({ content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.anchor",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{name{.+}}/files/{path{.+}}",
      tags: ["catalog"],
      summary: "Read an agent file",
      request: { params: z.object({ name: z.string(), path: z.string() }) },
      responses: {
        200: errorResponse("File bytes"),
        404: errorResponse("File not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      const path = c.req.param("path");
      let relPath = path;
      try {
        relPath = decodeURIComponent(path);
        const buf = await catalog.getAgentFile(name, relPath);
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
          meta: { fqn: name, relPath },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{name{.+}}/files",
      tags: ["catalog"],
      summary: "List an agent's files",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(CatalogFileEntrySchema.array(), "File entries"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const files = await catalog.listAgentFiles(name);
        return c.json(files);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.files.list",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{name{.+}}",
      tags: ["catalog"],
      summary: "Get an agent with content",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(AgentWithContentSchema, "Agent with content"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const entry = await catalog.getAgentEntry(name);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getAgentContent(name);
        return c.json({ ...entry, content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.get",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
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
      responses: {
        201: jsonResponse(CatalogInstallResultSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readInstallAgentRequest(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const result = await catalog.installAgent(parsed.origin);
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: agent install completed", {
          kind: "agent",
          origin: parsed.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.install",
          policy: catalogErrorPolicy,
          meta: { origin: parsed.origin },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{name{.+}}/sync/resolve",
      tags: ["catalog"],
      summary: "Preview an agent sync",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        // resolveSyncAgent stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await catalog.resolveSyncAgent(name);
        const planToken = catalog.cachePlan(plan);
        return c.json(planToManifest(plan, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync.resolve",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{name{.+}}/sync",
      tags: ["catalog"],
      summary: "Apply an agent sync",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(CatalogSyncResultSchema, "Sync result"),
        400: errorResponse("Malformed request body"),
        410: errorResponse("Plan token expired or already applied"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readPlanToken(c);
      if ("error" in parsed) return c.json(parsed, 400);
      const plan = catalog.takePlan(parsed.planToken);
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
      path: "/{name{.+}}/acknowledge-prereqs",
      tags: ["catalog"],
      summary: "Acknowledge an agent's prereqs",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.acknowledgeAgentPrereqs(name);
        logEvent(c, "catalog: agent prereqs acknowledged", { kind: "agent", fqn: name });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.acknowledgePrereqs",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{name{.+}}/disable",
      tags: ["catalog"],
      summary: "Disable an agent",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.disableAgent(name);
        logEvent(c, "catalog: agent disabled", { kind: "agent", fqn: name });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.disable",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{name{.+}}/enable",
      tags: ["catalog"],
      summary: "Enable an agent",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(AgentSchema, "Agent"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.enableAgent(name);
        logEvent(c, "catalog: agent enabled", { kind: "agent", fqn: name });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.enable",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{name{.+}}",
      tags: ["catalog"],
      summary: "Delete an agent",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(OkResponseSchema, "Deleted"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        await catalog.deleteAgent(name);
        logEvent(c, "catalog: agent removed", { kind: "agent", fqn: name });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  return app;
}
