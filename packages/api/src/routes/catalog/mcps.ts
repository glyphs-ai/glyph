import {
  ApplyPlanResponseSchema,
  type CatalogModule,
  GetMcpResponseSchema,
  ListMcpsResponseSchema,
  type McpFqn,
} from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../../_error-policies/catalog.js";
import { logEvent, problemResponse, respondError } from "../../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../../_http-helpers.js";
import { planStoreFor } from "./plan-store.js";
import { planToManifest, ResolveManifestSchema } from "./plan-to-manifest.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";
import { unwrapCatalog } from "./use-case.js";

// HTTP request bodies owned by this transport: the client posts an origin to
// install, and a planToken to apply a previously previewed sync.
const InstallMcpRequestSchema = z
  .object({
    origin: z.string().min(1, { message: "origin is required and must be a non-empty string" }),
  })
  .strict();
const SyncCatalogRequestSchema = z
  .object({
    planToken: z.string().min(1, {
      message: "body must be { planToken: string } from a prior /sync/resolve response",
    }),
  })
  .strict();

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
export function mcpsRoutes(arg: CatalogResolver | CatalogModule): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List installed MCPs",
      responses: {
        200: jsonResponse(ListMcpsResponseSchema, "Installed MCPs"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      // listMcps() already returns Mcp[] (`{ fqn, origin, ... }`),
      // matching the dashboard's `McpItem` shape. Returning it directly
      // avoids unnecessary wrapping.
      return c.json(await unwrapCatalog(catalog.listMcps.execute({}), "mcp"));
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{scope}/{name}",
      tags: ["catalog"],
      summary: "Get an MCP with content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(GetMcpResponseSchema.extend({ content: z.string() }), "MCP with content"),
        404: errorResponse("MCP not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const meta = await unwrapCatalog(catalog.getMcp.execute({ id: fqn as McpFqn }), "mcp");
        const content = await unwrapCatalog(
          catalog.getMcpContent.execute({ id: fqn as McpFqn }),
          "mcp",
        );
        return c.json({ ...meta, content: content.spec });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.get",
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
      summary: "Install an MCP from an origin",
      request: { body: jsonRequest(InstallMcpRequestSchema) },
      responses: {
        201: jsonResponse(ApplyPlanResponseSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "mcp", origin: body.origin }),
          "mcp",
        );
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: mcp install completed", {
          kind: "mcp",
          origin: body.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.install",
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
      summary: "Preview an MCP sync",
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
        // resolveSyncMcp stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await unwrapCatalog(catalog.resolvePlan.execute({ kind: "mcp", fqn }), "mcp");
        const planToken = planStoreFor(catalog).cache(plan);
        return c.json(planToManifest(plan, true, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.sync.resolve",
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
      summary: "Apply an MCP sync",
      request: {
        params: z.object({ scope: z.string().min(1), name: z.string().min(1) }),
        body: jsonRequest(SyncCatalogRequestSchema),
      },
      responses: {
        200: jsonResponse(ApplyPlanResponseSchema, "Sync result"),
        400: errorResponse("Malformed request body"),
        410: errorResponse("Plan token expired or already applied"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      const plan = planStoreFor(catalog).take(body.planToken);
      if (plan === null) {
        return problemResponse(c, 410, {
          code: "PlanTokenInvalid",
          detail: "preview expired or already applied; re-preview to continue",
        });
      }
      try {
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
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
      path: "/{scope}/{name}",
      tags: ["catalog"],
      summary: "Delete an MCP",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(z.object({ ok: z.literal(true) }), "Deleted"),
        409: errorResponse("MCP still has dependents"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        await unwrapCatalog(catalog.uninstallMcp.execute({ id: fqn as McpFqn }), "mcp");
        logEvent(c, "catalog: mcp removed", { kind: "mcp", fqn });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.delete",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  return app;
}
