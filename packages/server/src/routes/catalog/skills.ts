import {
  AnchorResponseSchema,
  CatalogFileEntrySchema,
  CatalogInstallResultSchema,
  CatalogSyncResultSchema,
  InstallSkillRequestSchema,
  OkResponseSchema,
  ResolveManifestSchema,
  SkillEntrySchema,
  SkillSchema,
  SkillWithContentSchema,
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
      request: { body: jsonRequest(InstallSkillRequestSchema) },
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
        const plan = await catalog.resolveSkill(body.origin);
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
      path: "/{scope}/{name}/anchor",
      tags: ["catalog"],
      summary: "Get a skill's anchor content",
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
        const content = await catalog.getSkillContent(fqn);
        return c.json({ content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.anchor",
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
      summary: "List a skill's files, or read one file's bytes",
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
          const buf = await catalog.getSkillFile(fqn, relPath);
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
            meta: { fqn, relPath },
          });
        }
      }
      try {
        const files = await catalog.listSkillFiles(fqn);
        return c.json(files);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.files.list",
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
      summary: "Get a skill with content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(SkillWithContentSchema, "Skill with content"),
        404: errorResponse("Skill not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const entry = await catalog.getSkillEntry(fqn);
        if (!entry) return c.json({ error: "not found", code: "NotFound" }, 404);
        const content = await catalog.getSkillContent(fqn);
        return c.json({ ...entry, content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.get",
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
      summary: "Install a skill from an origin",
      request: { body: jsonRequest(InstallSkillRequestSchema) },
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
        const result = await catalog.installSkill(body.origin);
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: skill install completed", {
          kind: "skill",
          origin: body.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.install",
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
      summary: "Preview a skill sync",
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
        // resolveSyncSkill reads the local origin off the row and stamps
        // it onto plan.rootOrigin — no second catalog round-trip needed.
        const plan = await catalog.resolveSyncSkill(fqn);
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
      summary: "Apply a skill sync",
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
      path: "/{scope}/{name}/acknowledge-prereqs",
      tags: ["catalog"],
      summary: "Acknowledge a skill's prereqs",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(SkillSchema, "Skill"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const skill = await catalog.acknowledgeSkillPrereqs(fqn);
        logEvent(c, "catalog: skill prereqs acknowledged", { kind: "skill", fqn });
        return c.json(skill);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.acknowledgePrereqs",
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
      summary: "Delete a skill",
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
        await catalog.deleteSkill(fqn);
        logEvent(c, "catalog: skill removed", { kind: "skill", fqn });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.skills.delete",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  return app;
}
