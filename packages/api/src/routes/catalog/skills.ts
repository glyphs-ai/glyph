import {
  ApplyPlanResponseSchema,
  type CatalogModule,
  GetSkillContentResponseSchema,
  GetSkillEntryResponseSchema,
  GetSkillResponseSchema,
  ListSkillEntriesResponseSchema,
  ListSkillFilesResponseSchema,
  type SkillFqn,
} from "@glyphs-ai/catalog";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { catalogErrorPolicy } from "../../_error-policies/catalog.js";
import { logEvent, problemResponse, respondError } from "../../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../../_http-helpers.js";
import { mimeFromExt } from "./mime.js";
import { planStoreFor } from "./plan-store.js";
import { planToManifest, ResolveManifestSchema } from "./plan-to-manifest.js";
import { type CatalogResolver, resolveCatalog } from "./resolver.js";
import { unwrapCatalog } from "./use-case.js";

// HTTP request bodies owned by this transport: the client posts an origin to
// install, and a planToken to apply a previously previewed sync.
const InstallSkillRequestSchema = z
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
export function skillsRoutes(arg: CatalogResolver | CatalogModule): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List skill entries",
      responses: {
        200: jsonResponse(ListSkillEntriesResponseSchema, "Skill entries"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => c.json(await unwrapCatalog(getCatalog(c).listSkillEntries.execute({}), "skill")),
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
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "skill", origin: body.origin }),
          "skill",
        );
        return c.json(planToManifest(plan, false));
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
        200: jsonResponse(GetSkillContentResponseSchema.omit({ id: true }), "Anchor content"),
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const content = await unwrapCatalog(
          catalog.getSkillContent.execute({ id: fqn as SkillFqn }),
          "skill",
        );
        return c.json({ content: content.content });
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
          ListSkillFilesResponseSchema,
          "File entries, or raw file bytes when ?path= is set",
        ),
        404: errorResponse("File not found"),
        503: errorResponse("Service unavailable"),
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
          const buf = await unwrapCatalog(
            catalog.getSkillFile.execute({ id: fqn as SkillFqn, relPath }),
            "skill",
          );
          if (buf === null)
            return problemResponse(c, 404, { code: "NotFound", detail: "not found" });
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
        const files = await unwrapCatalog(
          catalog.listSkillFiles.execute({ id: fqn as SkillFqn }),
          "skill",
        );
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
        200: jsonResponse(
          GetSkillEntryResponseSchema.unwrap().extend({ content: z.string() }),
          "Skill with content",
        ),
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const entry = await unwrapCatalog(
          catalog.getSkillEntry.execute({ id: fqn as SkillFqn }),
          "skill",
        );
        if (!entry) return problemResponse(c, 404, { code: "NotFound", detail: "not found" });
        const content = await unwrapCatalog(
          catalog.getSkillContent.execute({ id: fqn as SkillFqn }),
          "skill",
        );
        return c.json({ ...entry, content: content.content });
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
        201: jsonResponse(ApplyPlanResponseSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "skill", origin: body.origin }),
          "skill",
        );
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
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
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        // resolveSyncSkill reads the local origin off the row and stamps
        // it onto plan.rootOrigin — no second catalog round-trip needed.
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "skill", fqn }),
          "skill",
        );
        // Cache the plan and ship the token to the dashboard. /sync
        // trades the token back for this exact plan, so apply runs the
        // closure the user previewed (not a fresh resolve that could
        // silently differ).
        const planToken = planStoreFor(catalog).cache(plan);
        return c.json(planToManifest(plan, true, planToken));
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
        200: jsonResponse(ApplyPlanResponseSchema, "Sync result"),
        400: errorResponse("Malformed request body"),
        410: errorResponse("Plan token expired or already applied"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      const plan = planStoreFor(catalog).take(body.planToken);
      if (plan === null) {
        // Token unknown / already taken / expired → tell the caller to
        // re-preview. 410 Gone matches the "the resource you referenced
        // is no longer available" semantics; PlanTokenInvalid is the
        // single code the dashboard branches on to re-run resolve.
        return problemResponse(c, 410, {
          code: "PlanTokenInvalid",
          detail: "preview expired or already applied; re-preview to continue",
        });
      }
      try {
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
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
        200: jsonResponse(GetSkillResponseSchema, "Skill"),
        404: errorResponse("Skill not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const skill = await unwrapCatalog(
          catalog.acknowledgeSkillPrereqs.execute({ id: fqn as SkillFqn }),
          "skill",
        );
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
        200: jsonResponse(z.object({ ok: z.literal(true) }), "Deleted"),
        404: errorResponse("Skill not found"),
        409: errorResponse("Skill still has dependents"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        await unwrapCatalog(catalog.uninstallSkill.execute({ id: fqn as SkillFqn }), "skill");
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
