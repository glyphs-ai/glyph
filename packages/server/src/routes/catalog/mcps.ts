import {
  CatalogInstallResultSchema,
  CatalogSyncResultSchema,
  McpSchema,
  McpWithContentSchema,
  OkResponseSchema,
  ResolveManifestSchema,
} from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { createApiApp, errorResponse, jsonResponse } from "../_openapi.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readInstallMcpRequest, readPlanToken } from "./helpers.js";
import { planToManifest } from "./plan-to-manifest.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";

/**
 * Routes for /mcps/* relative to the parent mount. Mounted by
 * `catalogRoutes` at "/mcps".
 *
 * `POST /` body: `{ origin: string }`. The full MCP-spec FQN
 * (`<namespace>/<short>`, e.g. `azure/mcp`) is derived from the
 * fetched JSON's `_meta.name` field. MCPs have no deps, so the
 * install is a single fetch + write.
 *
 * Status mapping + body shaping flows through `respondError` against
 * `catalogErrorPolicy`. See `routes/catalog/agents.ts` for the same
 * pattern.
 */
export function mcpsRoutes(arg: CatalogResolver | CatalogService): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List installed MCPs",
      responses: {
        200: jsonResponse(McpSchema.array(), "Installed MCPs"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      // listMcps() already returns Mcp[] (`{ fqn, origin, ... }`),
      // matching the dashboard's `McpItem` shape. Returning it directly
      // avoids unnecessary wrapping.
      return c.json(await catalog.listMcps());
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{name{.+}}",
      tags: ["catalog"],
      summary: "Get an MCP with content",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(McpWithContentSchema, "MCP with content"),
        404: errorResponse("MCP not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const meta = await catalog.getMcp(name);
        if (meta === null) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getMcpContent(name);
        return c.json({ ...meta, content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.get",
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
      summary: "Install an MCP from an origin",
      responses: {
        201: jsonResponse(CatalogInstallResultSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readInstallMcpRequest(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const result = await catalog.installMcpFromOrigin(parsed.origin);
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: mcp install completed", {
          kind: "mcp",
          origin: parsed.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.install",
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
      summary: "Preview an MCP sync",
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
        // resolveSyncMcp stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await catalog.resolveSyncMcp(name);
        const planToken = catalog.cachePlan(plan);
        return c.json(planToManifest(plan, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.sync.resolve",
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
      summary: "Apply an MCP sync",
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
        logEvent(c, "catalog: mcp sync applied", {
          kind: "mcp",
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.sync",
          policy: catalogErrorPolicy,
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{name{.+}}",
      tags: ["catalog"],
      summary: "Delete an MCP",
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
        await catalog.deleteMcp(name);
        logEvent(c, "catalog: mcp removed", { kind: "mcp", fqn: name });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  return app;
}
