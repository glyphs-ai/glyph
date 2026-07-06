import {
  type AgentFqn,
  ApplyPlanResponseSchema,
  type CatalogModule,
  GetAgentContentResponseSchema,
  GetAgentEntryResponseSchema,
  GetAgentResponseSchema,
  ListAgentEntriesResponseSchema,
  ListAgentFilesResponseSchema,
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
const InstallAgentRequestSchema = z
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
export function agentsRoutes(arg: CatalogResolver | CatalogModule): OpenAPIHono {
  const app = createApiApp();
  const getCatalog = resolveCatalog(arg);

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["catalog"],
      summary: "List agent entries",
      responses: {
        200: jsonResponse(ListAgentEntriesResponseSchema, "Agent entries"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => c.json(await unwrapCatalog(getCatalog(c).listAgentEntries.execute({}), "agent")),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/resolve",
      tags: ["catalog"],
      summary: "Preview an agent install",
      request: { body: jsonRequest(InstallAgentRequestSchema) },
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "agent", origin: body.origin }),
          "agent",
        );
        return c.json(planToManifest(plan, false));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.resolve",
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
      summary: "Get an agent's anchor content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(GetAgentContentResponseSchema.omit({ id: true }), "Anchor content"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const content = await unwrapCatalog(
          catalog.getAgentContent.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        return c.json({ content: content.content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.anchor",
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
      summary: "List an agent's files, or read one file's bytes",
      request: {
        params: z.object({ scope: z.string().min(1), name: z.string().min(1) }),
        query: z.object({ path: z.string().optional() }),
      },
      responses: {
        200: jsonResponse(
          ListAgentFilesResponseSchema,
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
            catalog.getAgentFile.execute({ id: fqn as AgentFqn, relPath }),
            "agent",
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
            route: "catalog.agents.files.get",
            policy: catalogErrorPolicy,
            meta: { fqn, relPath },
          });
        }
      }
      try {
        const files = await unwrapCatalog(
          catalog.listAgentFiles.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        return c.json(files);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.files.list",
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
      summary: "Get an agent with content",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(
          GetAgentEntryResponseSchema.unwrap().extend({ content: z.string() }),
          "Agent with content",
        ),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const entry = await unwrapCatalog(
          catalog.getAgentEntry.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        if (!entry) return problemResponse(c, 404, { code: "NotFound", detail: "not found" });
        const content = await unwrapCatalog(
          catalog.getAgentContent.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        return c.json({ ...entry, content: content.content });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.get",
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
      summary: "Install an agent from an origin",
      request: { body: jsonRequest(InstallAgentRequestSchema) },
      responses: {
        201: jsonResponse(ApplyPlanResponseSchema, "Install result"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const body = c.req.valid("json");
      try {
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "agent", origin: body.origin }),
          "agent",
        );
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
        const status = result.failed.length > 0 ? 207 : 201;
        logEvent(c, "catalog: agent install completed", {
          kind: "agent",
          origin: body.origin,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.install",
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
      summary: "Preview an agent sync",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(ResolveManifestSchema, "Resolve manifest"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        // resolveSyncAgent stamps the local origin onto plan.rootOrigin —
        // no second catalog round-trip needed.
        const plan = await unwrapCatalog(
          catalog.resolvePlan.execute({ kind: "agent", fqn }),
          "agent",
        );
        const planToken = planStoreFor(catalog).cache(plan);
        return c.json(planToManifest(plan, true, planToken));
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync.resolve",
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
      summary: "Apply an agent sync",
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
        return problemResponse(c, 410, {
          code: "PlanTokenInvalid",
          detail: "preview expired or already applied; re-preview to continue",
        });
      }
      try {
        const result = (await catalog.applyPlan.execute({ plan }))._unsafeUnwrap();
        const status = result.failed.length > 0 ? 207 : 200;
        logEvent(c, "catalog: agent sync applied", {
          kind: "agent",
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        });
        return c.json(result, status);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.sync",
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
      summary: "Acknowledge an agent's prereqs",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(GetAgentResponseSchema, "Agent"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await unwrapCatalog(
          catalog.acknowledgeAgentPrereqs.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        logEvent(c, "catalog: agent prereqs acknowledged", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.acknowledgePrereqs",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/disable",
      tags: ["catalog"],
      summary: "Disable an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(GetAgentResponseSchema, "Agent"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await unwrapCatalog(
          catalog.disableAgent.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        logEvent(c, "catalog: agent disabled", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.disable",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{scope}/{name}/enable",
      tags: ["catalog"],
      summary: "Enable an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(GetAgentResponseSchema, "Agent"),
        404: errorResponse("Agent not found"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        const agent = await unwrapCatalog(
          catalog.enableAgent.execute({ id: fqn as AgentFqn }),
          "agent",
        );
        logEvent(c, "catalog: agent enabled", { kind: "agent", fqn });
        return c.json(agent);
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.enable",
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
      summary: "Delete an agent",
      request: { params: z.object({ scope: z.string().min(1), name: z.string().min(1) }) },
      responses: {
        200: jsonResponse(z.object({ ok: z.literal(true) }), "Deleted"),
        404: errorResponse("Agent not found"),
        409: errorResponse("Agent still has dependents"),
        503: errorResponse("Service unavailable"),
      },
    }),
    async (c) => {
      const catalog = getCatalog(c);
      const fqn = `${c.req.param("scope")}/${c.req.param("name")}`;
      try {
        await unwrapCatalog(catalog.uninstallAgent.execute({ id: fqn as AgentFqn }), "agent");
        logEvent(c, "catalog: agent removed", { kind: "agent", fqn });
        return c.json({ ok: true });
      } catch (err) {
        return respondError(c, err, {
          route: "catalog.agents.delete",
          policy: catalogErrorPolicy,
          meta: { fqn },
        });
      }
    },
  );

  return app;
}
