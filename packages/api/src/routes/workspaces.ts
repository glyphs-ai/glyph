import {
  GetLastOpenedWorkspaceIdResponseSchema,
  GetWorkspaceResponseSchema,
  ListWorkspacesResponseSchema,
  RegisterWorkspaceRequestSchema,
  RegisterWorkspaceResponseSchema,
  type WorkspaceId,
  type WorkspaceName,
} from "@glyphs-ai/workspace";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { respondWorkspaceError } from "../_error-policies/workspaces.js";
import { logEvent } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import type { Application } from "../application.js";

/** `:id` URL path-parameter validator (the mount-level workspace id). */
const WorkspacePathParamsSchema = z.object({ id: z.string() });
/** Request body for `PUT /current` — select the current workspace by id. */
const SetCurrentWorkspaceRequestSchema = z.object({ id: z.string().min(1) }).strict();

/**
 * Routes for `/api/workspaces/*`. Workspace-scoped resources (sessions,
 * tasks, catalog) live under `/api/workspaces/:id/...` and are mounted
 * separately so the workspace id is part of the resource URL.
 *
 * This is a thin transport adapter — every endpoint is parse body →
 * dispatch to the workspace module's use-case → format response. The
 * orchestration (UUID minting, default workspaceDir, cache
 * invalidation) lives in the use-case + `Application` so CLI / MCP /
 * SDK consumers get it for free.
 *
 * Workspace ids arriving from URL params are raw `string`s; we cast
 * to the branded `WorkspaceId` at the call site because the use-case
 * re-parses through `WorkspaceIdSchema` on entry (defense in depth)
 * and surfaces a malformed id as a `ZodError` the
 * `respondWorkspaceError` helper renders.
 */
export function workspacesRoutes(application: Application): OpenAPIHono {
  const app = createApiApp();
  const { workspace } = application;

  // List all registered workspaces.
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["workspaces"],
      summary: "List registered workspaces",
      responses: {
        200: jsonResponse(ListWorkspacesResponseSchema, "Registered workspaces"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const res = await workspace.listWorkspaces.execute({});
      return res.match(
        (list) => c.json(list),
        (err) => respondWorkspaceError(c, err, { route: "workspaces.list", defaultStatus: 500 }),
      );
    },
  );

  // Create a workspace. `name` required. `workspaceDir` optional — when
  // omitted, the use-case mints `<defaultWorkspaceParent>/<uuid>/`.
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
        201: jsonResponse(RegisterWorkspaceResponseSchema, "Created workspace"),
        400: errorResponse("Malformed request body"),
        409: errorResponse("Workspace directory already registered"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const res = await workspace.registerWorkspace.execute(body);
      return res.match(
        (view) => {
          logEvent(c, "workspace created", {
            workspaceId: view.id,
            name: view.name,
            workspaceDir: view.workspaceDir,
          });
          return c.json(view, 201);
        },
        (err) => respondWorkspaceError(c, err, { route: "workspaces.create" }),
      );
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
        200: jsonResponse(GetLastOpenedWorkspaceIdResponseSchema, "Current workspace id (or null)"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const res = await workspace.getLastOpenedWorkspaceId.execute({});
      return res.match(
        (view) => c.json(view),
        (err) =>
          respondWorkspaceError(c, err, {
            route: "workspaces.getCurrent",
            defaultStatus: 500,
          }),
      );
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
        200: jsonResponse(GetLastOpenedWorkspaceIdResponseSchema, "Selected workspace id"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workspace not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const res = await workspace.openWorkspace.execute({ id: body.id as WorkspaceId });
      return res.match(
        () => {
          logEvent(c, "workspace selected as current", { workspaceId: body.id });
          return c.json({ id: body.id });
        },
        (err) =>
          respondWorkspaceError(c, err, {
            route: "workspaces.setCurrent",
            meta: { workspaceId: body.id },
          }),
      );
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
        200: jsonResponse(GetWorkspaceResponseSchema, "Workspace"),
        404: errorResponse("Workspace not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const res = await workspace.getWorkspace.execute({ id: id as WorkspaceId });
      return res.match(
        (view) => {
          if (!view) {
            return c.json({ error: "workspace not found", code: "WorkspaceNotFound" }, 404);
          }
          return c.json(view);
        },
        (err) =>
          respondWorkspaceError(c, err, {
            route: "workspaces.get",
            meta: { workspaceId: id },
            defaultStatus: 500,
          }),
      );
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
        body: jsonRequest(z.object({ name: z.string() }).strict()),
      },
      responses: {
        200: jsonResponse(GetWorkspaceResponseSchema, "Updated workspace"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Workspace not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const body = c.req.valid("json");
      // The PATCH body deliberately accepts a plain string and routes
      // it through `Application.renameWorkspace`, which delegates to
      // the use-case where `RenameWorkspaceRequestSchema` enforces the
      // branded `WorkspaceName` shape. Validation failures surface as
      // ZodError → 400 via the route's onError handler.
      const res = await application.renameWorkspace(id, { name: body.name as WorkspaceName });
      return res.match(
        (view) => {
          if (!view) {
            return c.json({ error: "workspace not found", code: "WorkspaceNotFound" }, 404);
          }
          logEvent(c, "workspace updated", { workspaceId: id, newName: body.name });
          return c.json(view);
        },
        (err) =>
          respondWorkspaceError(c, err, {
            route: "workspaces.patch",
            meta: { workspaceId: id },
            defaultStatus: 500,
          }),
      );
    },
  );

  // Remove a workspace from the registry (idempotent, metadata-only).
  // On-disk files under workspaceDir are left untouched — each package
  // owns the lifecycle of its own subdir.
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["workspaces"],
      summary: "Delete a workspace",
      request: {
        params: WorkspacePathParamsSchema,
      },
      responses: {
        204: errorResponse("Deleted (no content)"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const res = await application.unregisterWorkspace(id);
      return res.match(
        () => {
          logEvent(c, "workspace deleted", { workspaceId: id });
          return c.body(null, 204);
        },
        (err) =>
          respondWorkspaceError(c, err, {
            route: "workspaces.delete",
            meta: { workspaceId: id },
          }),
      );
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
        404: errorResponse("Workspace not found"),
        409: errorResponse("Workspace has live tasks"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      try {
        const view = await application.reloadWorkspace(id);
        if (view === null) {
          return c.json({ error: "workspace not found", code: "WorkspaceNotFound" }, 404);
        }
        logEvent(c, "workspace reload requested via API", { workspaceId: id });
        return c.body(null, 204);
      } catch (err) {
        return respondWorkspaceError(c, err, {
          route: "workspaces.reload",
          meta: { workspaceId: id },
          defaultStatus: 500,
        });
      }
    },
  );

  return app;
}
