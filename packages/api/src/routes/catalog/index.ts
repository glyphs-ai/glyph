import type { CatalogModule } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp, errorResponse, jsonResponse } from "../../_http-helpers.js";
import { CatalogOverviewSchema } from "../../schemas/catalog.js";
import { agentsRoutes } from "./agents.js";
import { mcpsRoutes } from "./mcps.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";
import { skillsRoutes } from "./skills.js";

/**
 * Workspace-scoped catalog routes. The routes pull a per-workspace
 * `CatalogModule` ({@link CatalogModule} writes + {@link CatalogModule}
 * reads) off the Hono context, set up by the workspace middleware.
 *
 * Tests can pass a `CatalogModule` directly. The catalog brings its
 * own `FetcherRegistry` via `CatalogModuleOpts.fetchers`; routes don't
 * thread fetchers through.
 */
export function catalogRoutes(arg: CatalogResolver | CatalogModule): OpenAPIHono {
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
        queries.listSkillEntries.execute({}).then((result) => result._unsafeUnwrap()),
        queries.listAgentEntries.execute({}).then((result) => result._unsafeUnwrap()),
        queries.listMcps.execute({}).then((result) => result._unsafeUnwrap()),
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
