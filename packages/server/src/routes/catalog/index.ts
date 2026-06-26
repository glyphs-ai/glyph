import { CatalogOverviewSchema } from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "../_openapi.js";
import { agentsRoutes } from "./agents.js";
import { mcpsRoutes } from "./mcps.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";
import { skillsRoutes } from "./skills.js";

/**
 * Workspace-scoped catalog routes. The routes pull a per-workspace
 * `CatalogService` ({@link CatalogService} writes + {@link CatalogService}
 * reads) off the Hono context, set up by the workspace middleware.
 *
 * Tests can pass a `CatalogService` directly. The catalog brings its
 * own `FetcherRegistry` via `CatalogServiceOpts.fetchers`; routes don't
 * thread fetchers through.
 */
export function catalogRoutes(arg: CatalogResolver | CatalogService): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.route("/skills", skillsRoutes(getCatalog));
  app.route("/agents", agentsRoutes(getCatalog));
  app.route("/mcps", mcpsRoutes(getCatalog));

  app.openapi(
    createRoute({
      method: "get",
      path: "/overview",
      tags: ["catalog"],
      summary: "Catalog overview counts",
      responses: {
        200: jsonResponse(CatalogOverviewSchema, "Overview counts"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const queries = getCatalog(c);
      const [skills, agents, mcps] = await Promise.all([
        queries.listSkillEntries(),
        queries.listAgentEntries(),
        queries.listMcps(),
      ]);
      return c.json({
        counts: {
          skills: skills.length,
          agents: agents.length,
          mcps: mcps.length,
          blocked:
            skills.filter((s) => s.status === "blocked").length +
            agents.filter((a) => a.status === "blocked").length,
          orphaned:
            skills.filter((s) => s.skill.orphaned).length + mcps.filter((m) => m.orphaned).length,
        },
      });
    },
  );

  return app;
}

export type { CatalogResolver } from "./resolver.js";
