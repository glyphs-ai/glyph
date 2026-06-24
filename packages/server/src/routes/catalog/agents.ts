import type { CatalogService } from "@glyphs-ai/catalog";
import { Hono } from "hono";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { defineHandler } from "../_handler.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readAgentInstallBody, readPlanTokenBody } from "./helpers.js";
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
export function agentsRoutes(arg: CatalogResolver | CatalogService): Hono {
  const app = new Hono();
  const getCatalog = resolveCatalog(arg);

  app.get(
    "/",
    defineHandler("catalog.agents.list", async (c) => getCatalog(c).listAgentEntries()),
  );

  app.post(
    "/resolve",
    defineHandler("catalog.agents.resolve", async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readAgentInstallBody(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const plan = await catalog.resolveAgentFromOrigin(parsed.origin);
        return planToManifest(plan);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.resolve",
          policy: catalogErrorPolicy,
        });
      }
    }),
  );

  app.get(
    "/:name{.+}/anchor",
    defineHandler("catalog.agents.anchor.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const content = await catalog.getAgentContent(name);
        return { content };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.anchor",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.get(
    "/:name{.+}/files/:path{.+}",
    defineHandler("catalog.agents.files.get", async (c) => {
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
    }),
  );

  app.get(
    "/:name{.+}/files",
    defineHandler("catalog.agents.files.list", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const files = await catalog.listAgentFiles(name);
        return files;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.files.list",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.get(
    "/:name{.+}",
    defineHandler("catalog.agents.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const entry = await catalog.getAgentEntry(name);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getAgentContent(name);
        return { ...entry, content };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.get",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/",
    defineHandler(
      "catalog.agents.install",
      async (c) => {
        const catalog = getCatalog(c);
        const parsed = await readAgentInstallBody(c);
        if ("error" in parsed) return c.json(parsed, 400);
        try {
          const result = await catalog.installAgent(parsed.origin);
          logEvent(c, "catalog: agent install completed", {
            kind: "agent",
            origin: parsed.origin,
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.agents.install",
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
    defineHandler("catalog.agents.sync.resolve", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        // resolveSyncAgent stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await catalog.resolveSyncAgent(name);
        const planToken = catalog.cachePlan(plan);
        return planToManifest(plan, planToken);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync.resolve",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/:name{.+}/sync",
    defineHandler(
      "catalog.agents.sync",
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
          logEvent(c, "catalog: agent sync applied", {
            kind: "agent",
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.agents.sync",
            policy: catalogErrorPolicy,
          });
        }
      },
      { status: (r) => (r.failed.length > 0 ? 207 : 200) },
    ),
  );

  app.post(
    "/:name{.+}/acknowledge-prereqs",
    defineHandler("catalog.agents.prereqs.acknowledge", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.acknowledgeAgentPrereqs(name);
        logEvent(c, "catalog: agent prereqs acknowledged", { kind: "agent", fqn: name });
        return agent;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.acknowledgePrereqs",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/:name{.+}/disable",
    defineHandler("catalog.agents.disable", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.disableAgent(name);
        logEvent(c, "catalog: agent disabled", { kind: "agent", fqn: name });
        return agent;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.disable",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/:name{.+}/enable",
    defineHandler("catalog.agents.enable", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const agent = await catalog.enableAgent(name);
        logEvent(c, "catalog: agent enabled", { kind: "agent", fqn: name });
        return agent;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.enable",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.delete(
    "/:name{.+}",
    defineHandler("catalog.agents.delete", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        await catalog.deleteAgent(name);
        logEvent(c, "catalog: agent removed", { kind: "agent", fqn: name });
        return { ok: true };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  return app;
}
