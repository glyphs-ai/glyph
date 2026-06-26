import {
  AnchorResponseSchema,
  CatalogFileEntrySchema,
  CatalogInstallResultSchema,
  CatalogSyncResultSchema,
  OkResponseSchema,
  ResolveManifestSchema,
  SkillEntrySchema,
  SkillSchema,
  SkillWithContentSchema,
} from "@glyphs-ai/api";
import type { CatalogService } from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../_error-policies/catalog.js";
import { createApiApp, errorResponse, jsonResponse } from "../_openapi.js";
import { respondError } from "../_respond-error.js";
import { logEvent } from "../_shared.js";
import { readInstallSkillRequest, readPlanToken } from "./helpers.js";
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
export function skillsRoutes(arg: CatalogResolver | CatalogService): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List skill entries",
      responses: {
        200: jsonResponse(SkillEntrySchema.array(), "Skill entries"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => c.json(await getCatalog(c).listSkillEntries()),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/resolve",
      tags: ["catalog"],
      summary: "Preview a skill install",
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readInstallSkillRequest(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const plan = await catalog.resolveSkill(parsed.origin);
        return c.json(planToManifest(plan));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.resolve",
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
      summary: "Get a skill's anchor content",
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
        const content = await catalog.getSkillContent(name);
        return c.json({ content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.anchor",
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
      summary: "Read a skill file",
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
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{name{.+}}/files",
      tags: ["catalog"],
      summary: "List a skill's files",
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
        const files = await catalog.listSkillFiles(name);
        return c.json(files);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.files.list",
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
      summary: "Get a skill with content",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(SkillWithContentSchema, "Skill with content"),
        404: errorResponse("Skill not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const entry = await catalog.getSkillEntry(name);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getSkillContent(name);
        return c.json({ ...entry, content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.get",
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
      summary: "Install a skill from an origin",
      responses: {
        201: jsonResponse(CatalogInstallResultSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const parsed = await readInstallSkillRequest(c);
      if ("error" in parsed) return c.json(parsed, 400);
      try {
        const result = await catalog.installSkill(parsed.origin);
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: skill install completed", {
          kind: "skill",
          origin: parsed.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.install",
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
      summary: "Preview a skill sync",
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
        // resolveSyncSkill reads the local origin off the row and stamps
        // it onto plan.rootOrigin — no second catalog round-trip needed.
        const plan = await catalog.resolveSyncSkill(name);
        // Cache the plan and ship the token to the dashboard. /sync
        // trades the token back for this exact plan, so apply runs the
        // closure the user previewed (not a fresh resolve that could
        // silently differ).
        const planToken = catalog.cachePlan(plan);
        return c.json(planToManifest(plan, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.sync.resolve",
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
      summary: "Apply a skill sync",
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
        const status = result.failed.length > 0 ? 207 : 200;
        logEvent(c, "catalog: skill sync applied", {
          kind: "skill",
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.sync",
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
      summary: "Acknowledge a skill's prereqs",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        200: jsonResponse(SkillSchema, "Skill"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const name = c.req.param("name");
      try {
        const skill = await catalog.acknowledgeSkillPrereqs(name);
        logEvent(c, "catalog: skill prereqs acknowledged", { kind: "skill", fqn: name });
        return c.json(skill);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.acknowledgePrereqs",
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
      summary: "Delete a skill",
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
        await catalog.deleteSkill(name);
        logEvent(c, "catalog: skill removed", { kind: "skill", fqn: name });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.delete",
          policy: catalogErrorPolicy,
          meta: { fqn: name },
        });
      }
    },
  );

  return app;
}
