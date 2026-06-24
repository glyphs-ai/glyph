import type { CatalogService } from "@glyphs-ai/catalog";
import { Hono } from "hono";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { defineHandler } from "../_handler.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readPlanTokenBody, readSkillInstallBody } from "./helpers.js";
import { mimeFromExt } from "./mime.js";
import { planToManifest } from "./plan-to-manifest.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";

/**
 * Routes for /skills/* relative to the parent mount. Mounted by
 * `catalogRoutes` at "/skills".
 *
 * Two endpoints for installs:
 *   - `POST /resolve` — read-only preview (returns CatalogPlan)
 *   - `POST /` — full install (resolve + apply, returns CatalogInstallResult)
 *
 * Dashboard's two-phase flow uses `/resolve` to show the user what
 * will happen, then `/` to commit.
 *
 * Status mapping + body shaping flows through `respondError` against
 * `catalogErrorPolicy`. See `routes/catalog/agents.ts` for the same
 * pattern.
 */
export function skillsRoutes(arg: CatalogResolver | CatalogService): Hono {
  const app = new Hono();
  const getCatalog = resolveCatalog(arg);

  app.get(
    "/",
    defineHandler("catalog.skills.list", async (c) => getCatalog(c).listSkillEntries()),
  );

  app.post(
    "/resolve",
    defineHandler("catalog.skills.resolve", async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readSkillInstallBody(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const plan = await catalog.resolveSkill(parsed.origin);
        return planToManifest(plan);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.resolve",
          policy: catalogErrorPolicy,
        });
      }
    }),
  );

  app.get(
    "/:name{.+}/anchor",
    defineHandler("catalog.skills.anchor.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const content = await catalog.getSkillContent(name);
        return { content };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.anchor",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.get(
    "/:name{.+}/files/:path{.+}",
    defineHandler("catalog.skills.files.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      const path = c.req.param("path");
      let relPath = path;
      try {
        relPath = decodeURIComponent(path);
        const buf = await catalog.getSkillFile(name, relPath);
        if (buf === null) return c.json({ error: "not found", code: "NotFound" }, 404);
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        return new Response(ab, {
          headers: { "Content-Type": mimeFromExt(relPath) },
        });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.files.get",
          policy: catalogErrorPolicy,
          meta: { fqn: name, relPath },
        });
      }
    }),
  );

  app.get(
    "/:name{.+}/files",
    defineHandler("catalog.skills.files.list", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const files = await catalog.listSkillFiles(name);
        return files;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.files.list",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.get(
    "/:name{.+}",
    defineHandler("catalog.skills.get", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const entry = await catalog.getSkillEntry(name);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getSkillContent(name);
        return { ...entry, content };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.get",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/",
    defineHandler(
      "catalog.skills.install",
      async (c) => {
        const catalog = getCatalog(c);
        const parsed = await readSkillInstallBody(c);
        if ("error" in parsed) return c.json(parsed, 400);
        try {
          const result = await catalog.installSkill(parsed.origin);
          logEvent(c, "catalog: skill install completed", {
            kind: "skill",
            origin: parsed.origin,
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.skills.install",
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
    defineHandler("catalog.skills.sync.resolve", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        // resolveSyncSkill reads the local origin off the row and stamps
        // it onto plan.rootOrigin — no second catalog round-trip needed.
        const plan = await catalog.resolveSyncSkill(name);
        // Cache the plan and ship the token to the dashboard. /sync
        // trades the token back for this exact plan, so apply runs the
        // closure the user previewed (not a fresh resolve that could
        // silently differ).
        const planToken = catalog.cachePlan(plan);
        return planToManifest(plan, planToken);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.sync.resolve",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.post(
    "/:name{.+}/sync",
    defineHandler(
      "catalog.skills.sync",
      async (c) => {
        const catalog = getCatalog(c);
        const parsed = await readPlanTokenBody(c);
        if ("error" in parsed) return c.json(parsed, 400);
        const plan = catalog.takePlan(parsed.planToken);
        if (plan === null) {
          // Token unknown / already taken / expired → tell the caller to
          // re-preview. 410 Gone matches the "the resource you referenced
          // is no longer available" semantics; PlanTokenInvalid is the
          // single code the dashboard branches on to re-run resolve.
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
          logEvent(c, "catalog: skill sync applied", {
            kind: "skill",
            installed: result.installed.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          });
          return result;
        } catch (err) {
          return respondError(c, err, {
            route: "catalog.skills.sync",
            policy: catalogErrorPolicy,
          });
        }
      },
      { status: (r) => (r.failed.length > 0 ? 207 : 200) },
    ),
  );

  app.post(
    "/:name{.+}/acknowledge-prereqs",
    defineHandler("catalog.skills.prereqs.acknowledge", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const skill = await catalog.acknowledgeSkillPrereqs(name);
        logEvent(c, "catalog: skill prereqs acknowledged", { kind: "skill", fqn: name });
        return skill;
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.acknowledgePrereqs",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  app.delete(
    "/:name{.+}",
    defineHandler("catalog.skills.delete", async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        await catalog.deleteSkill(name);
        logEvent(c, "catalog: skill removed", { kind: "skill", fqn: name });
        return { ok: true };
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    }),
  );

  return app;
}
