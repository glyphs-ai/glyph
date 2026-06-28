import {
  CurrentWorkspaceResponseSchema,
  RegisterWorkspaceRequestSchema,
  RenameWorkspaceRequestSchema,
  SetCurrentWorkspaceRequestSchema,
  WorkspacePathParamsSchema,
  WorkspaceSchema,
} from "@glyphs-ai/workspace/contract";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { workspacesErrorPolicy } from "../_error-policies/workspaces.js";
import { logEvent, respondError } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import type { Application } from "../application.js";

/**
 * Routes for `/api/workspaces/*`. Workspace-scoped resources (sessions,
 * tasks, catalog) live under `/api/workspaces/:id/...` and are mounted
 * separately so the workspace id is part of the resource URL.
 *
 * This is a thin transport adapter — every endpoint is parse body →
 * dispatch to the application layer → format response. The orchestration
 * (UUID minting, default workspaceDir, cache invalidation) lives in the
 * application so CLI / MCP / SDK consumers get it for free.
 */
export function workspacesRoutes(application: Application): OpenAPIHono {
  const app = createApiApp();
  const { workspaceService: service } = application;

  // List all registered workspaces.
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["workspaces"],
      summary: "List registered workspaces",
      responses: {
        200: jsonResponse(WorkspaceSchema.array(), "Registered workspaces"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      try {
        return c.json(await service.list());
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.list",
          policy: workspacesErrorPolicy,
          defaultStatus: 500,
        });
      }
    },
  );

  // Create a workspace. `name` required. `workspaceDir` optional — when
  // omitted, core mints `<defaultWorkspaceParent>/<uuid>/`.
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["workspaces"],
      summary: "Create a workspace",
      request: {
        body: jsonRequest(RegisterWorkspaceRequestSchema),
      },
      responses: {
        201: jsonResponse(WorkspaceSchema, "Created workspace"),
        400: errorResponse("Malformed request body"),
        409: errorResponse("Workspace directory already registered"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const view = await service.register(body);
        logEvent(c, "workspace created", {
          workspaceId: view.id,
          name: view.name,
          workspaceDir: view.workspaceDir,
        });
        return c.json(view, 201);
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.create",
          policy: workspacesErrorPolicy,
        });
      }
    },
  );

  // Read the currently-selected workspace id.
  app.openapi(
    createRoute({
      method: "get",
      path: "/current",
      tags: ["workspaces"],
      summary: "Get the current workspace id",
      responses: {
        200: jsonResponse(CurrentWorkspaceResponseSchema, "Current workspace id (or null)"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      try {
        return c.json({ id: await service.getLastOpenedId() });
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.getCurrent",
          policy: workspacesErrorPolicy,
          defaultStatus: 500,
        });
      }
    },
  );

  // Set the currently-selected workspace by id (mark as just-opened).
  app.openapi(
    createRoute({
      method: "put",
      path: "/current",
      tags: ["workspaces"],
      summary: "Set the current workspace",
      request: {
        body: jsonRequest(SetCurrentWorkspaceRequestSchema),
      },
      responses: {
        200: jsonResponse(CurrentWorkspaceResponseSchema, "Selected workspace id"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workspace not registered"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        await service.open(body.id);
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.setCurrent",
          policy: workspacesErrorPolicy,
        });
      }
      logEvent(c, "workspace selected as current", { workspaceId: body.id });
      return c.json({ id: body.id });
    },
  );

  // Get a single workspace.
  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["workspaces"],
      summary: "Get a workspace",
      request: { params: WorkspacePathParamsSchema },
      responses: {
        200: jsonResponse(WorkspaceSchema, "Workspace"),
        404: errorResponse("Workspace not registered"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      let view: Awaited<ReturnType<typeof service.get>>;
      try {
        view = await service.get(id);
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.get",
          policy: workspacesErrorPolicy,
          meta: { workspaceId: id },
          defaultStatus: 500,
        });
      }
      if (!view) {
        return c.json(
          { error: "workspace not registered", code: "WorkspaceNotRegisteredError" },
          404,
        );
      }
      return c.json(view);
    },
  );

  // Rename a workspace (`name` is currently the only mutable field).
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{id}",
      tags: ["workspaces"],
      summary: "Rename a workspace",
      request: {
        params: WorkspacePathParamsSchema,
        body: jsonRequest(RenameWorkspaceRequestSchema),
      },
      responses: {
        200: jsonResponse(WorkspaceSchema, "Updated workspace"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workspace not registered"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      try {
        const view = await application.renameWorkspace(id, body);
        if (!view) {
          return c.json(
            { error: "workspace not registered", code: "WorkspaceNotRegisteredError" },
            404,
          );
        }
        logEvent(c, "workspace updated", { workspaceId: id, newName: body.name });
        return c.json(view);
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.patch",
          policy: workspacesErrorPolicy,
          meta: { workspaceId: id },
          defaultStatus: 500,
        });
      }
    },
  );

  // Remove a workspace (idempotent). Default removes only metadata;
  // `?purge=1` also deletes glyph-owned subdirs (sessions/, tasks/).
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["workspaces"],
      summary: "Delete a workspace",
      request: {
        params: WorkspacePathParamsSchema,
        query: z.object({ purge: z.string().optional() }),
      },
      responses: {
        204: errorResponse("Deleted (no content)"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const purge = c.req.query("purge") === "1";
      try {
        await application.unregisterWorkspace(id, { purge });
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.delete",
          policy: workspacesErrorPolicy,
          meta: { workspaceId: id, purge },
        });
      }
      logEvent(c, "workspace deleted", { workspaceId: id, purge });
      return c.body(null, 204);
    },
  );

  // Force-rebuild the cached per-workspace container.
  //   - 204 on success (the fresh container is also pre-loaded so the
  //     next request hits cache).
  //   - 404 if the workspace is no longer registered.
  //   - 409 with `code=WorkspaceHasLiveTasksError` when reload would
  //     orphan live task subprocesses.
  //   - 500 for any other load failure.
  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/reload",
      tags: ["workspaces"],
      summary: "Rebuild the cached workspace container",
      request: { params: WorkspacePathParamsSchema },
      responses: {
        204: errorResponse("Reloaded (no content)"),
        404: errorResponse("Workspace not registered"),
        409: errorResponse("Workspace has live tasks"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      try {
        const view = await application.reloadWorkspace(id);
        if (view === null) {
          return c.json(
            { error: "workspace not registered", code: "WorkspaceNotRegisteredError" },
            404,
          );
        }
        logEvent(c, "workspace reload requested via API", { workspaceId: id });
        return c.body(null, 204);
      } catch (err) {
        return respondError(c, err, {
          route: "workspaces.reload",
          policy: workspacesErrorPolicy,
          meta: { workspaceId: id },
          defaultStatus: 500,
        });
      }
    },
  );

  return app;
}
