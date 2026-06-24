import type { CatalogService } from "@glyphs-ai/catalog";
import { Hono } from "hono";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { defineHandler } from "../_handler.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readMcpInstallBody, readPlanTokenBody } from "./helpers.js";
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
export function mcpsRoutes(arg: CatalogResolver | CatalogService): Hono {
  const app = new Hono();
  const getCatalog = resolveCatalog(arg);

  app.get(
    "/",
    defineHandler("catalog.mcps.list", async (c) => {
      const catalog = getCatalog(c);
      // listMcps() already returns Mcp[] (`{ fqn, origin, ... }`),
      // matching the dashboard's `McpItem` shape. Returning it directly
      // avoids unnecessary wrapping.
      return catalog.listMcps();
    }),
  );

  app.get(
    "/:name{.+}",
    defineHandler("catalog.mcps.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const meta = await catalog.getMcp(name);
        if (meta === null) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getMcpContent(name);
        return { ...meta, content };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.get",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/",
    defineHandler(
      "catalog.mcps.install",
      async (c) => {
        const catalog = getCatalog(c);
        const parsed = await readMcpInstallBody(c);
        if ("error" in parsed) return c.json(parsed, 400);
        try {
          const result = await catalog.installMcpFromOrigin(parsed.origin);
          logEvent(c, "catalog: mcp install completed", {
            kind: "mcp",
            origin: parsed.origin,
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.mcps.install",
            policy: catalogErrorPolicy,
            meta: { origin: parsed.origin },
          });
        }
      },
      { status: (r) => (r.failed.length > 0 ? 207 : 201) },
    ),
  );

  app.post(
    "/:name{.+}/sync/resolve",
    defineHandler("catalog.mcps.sync.resolve", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        // resolveSyncMcp stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await catalog.resolveSyncMcp(name);
        const planToken = catalog.cachePlan(plan);
        return planToManifest(plan, planToken);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.sync.resolve",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/:name{.+}/sync",
    defineHandler(
      "catalog.mcps.sync",
      async (c) => {
        const catalog = getCatalog(c);
        const parsed = await readPlanTokenBody(c);
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
          logEvent(c, "catalog: mcp sync applied", {
            kind: "mcp",
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.mcps.sync",
            policy: catalogErrorPolicy,
          });
        }
      },
      { status: (r) => (r.failed.length > 0 ? 207 : 200) },
    ),
  );

  app.delete(
    "/:name{.+}",
    defineHandler("catalog.mcps.delete", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        await catalog.deleteMcp(name);
        logEvent(c, "catalog: mcp removed", { kind: "mcp", fqn: name });
        return { ok: true };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.mcps.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  return app;
}
