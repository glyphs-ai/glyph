/**
 * Workspace routes (top-level + current-selection) plus the workspace
 * request / response wire shapes. {@link WorkspacePathParams} is the
 * shared `:id` path-param shape every workspace-scoped domain module
 * (`sessions`, `tasks`, `schedules`, `workflows`, `catalog`) imports.
 */

import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";

/**
 * Wire shape of a workspace as returned by the workspaces routes. Subset
 * of the `@glyphs-ai/workspace` aggregate — only the fields the dashboard /
 * CLI need; internal book-keeping fields stay private to the package.
 *
 * `workspaceDir` is the workspace's root directory. The shorter name
 * `workdir` is reserved for derived per-entity working directories
 * (`Session.workdir` / `Task.workdir`).
 */
export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly workspaceDir: string;
  readonly lastOpenedAt: string;
}

/** POST /api/workspaces body. */
export interface WorkspaceCreateBody {
  /** Display name (required). */
  readonly name: string;
  /** Absolute filesystem path. When omitted, server mints `<GLYPH_HOME>/workspaces/<uuid>`. */
  readonly workspaceDir?: string;
}

/**
 * Body returned with HTTP 202 by any `/api/workspaces/:id/*` route
 * when the per-workspace context is still being built. The client
 * should back off (honour the `Retry-After` response header — default
 * 2 s) and retry. Mirrors the response body produced by the server's
 * `workspaceContextMiddleware`; the dashboard reads this shape to
 * distinguish a transient warming state from a typed payload.
 */
export interface WorkspaceWarmingBody {
  readonly state: "warming";
  readonly workspaceId: string;
}

/**
 * Body returned with HTTP 503 by any `/api/workspaces/:id/*` route
 * when the per-workspace context fails to load. The client should
 * back off (honour `Retry-After` — default 5 s) and retry.
 * `code` is the canonical `WorkspaceLoadError` class name so UI
 * surfaces can branch without string-matching the message.
 */
export interface WorkspaceLoadFailedBody {
  readonly error: string;
  readonly code: "WorkspaceLoadError";
}

/** PUT /api/workspaces/current body. */
export interface WorkspaceCurrentPutBody {
  readonly id: string;
}

/** PATCH /api/workspaces/:id body. The only mutable field today is `name`. */
export interface WorkspacePatchBody {
  /** New display name. Skipped when `undefined`. */
  readonly name?: string;
}

/** GET /api/workspaces/current response. `null` when no workspace is selected. */
export interface WorkspaceCurrentRes {
  readonly id: string | null;
}

/** Workspace-scoped resource path params. */
export interface WorkspacePathParams {
  readonly id: string;
}

export const workspaceRoutes = {
  "workspaces.list": defineRoute<Record<string, never>, readonly WorkspaceSummary[]>(
    "GET",
    "/api/workspaces",
  ),
  "workspaces.create": defineRoute<{ body: WorkspaceCreateBody }, WorkspaceSummary>(
    "POST",
    "/api/workspaces",
  ),
  "workspaces.current.get": defineRoute<Record<string, never>, WorkspaceCurrentRes>(
    "GET",
    "/api/workspaces/current",
  ),
  "workspaces.current.set": defineRoute<{ body: WorkspaceCurrentPutBody }, WorkspaceCurrentRes>(
    "PUT",
    "/api/workspaces/current",
  ),
  "workspaces.get": defineRoute<{ params: WorkspacePathParams }, WorkspaceSummary>(
    "GET",
    "/api/workspaces/:id",
  ),
  "workspaces.update": defineRoute<
    { params: WorkspacePathParams; body: WorkspacePatchBody },
    WorkspaceSummary
  >("PATCH", "/api/workspaces/:id"),
  "workspaces.delete": defineRoute<{ params: WorkspacePathParams; query: { purge?: "1" } }, void>(
    "DELETE",
    "/api/workspaces/:id",
  ),
  "workspaces.reload": defineRoute<{ params: WorkspacePathParams }, void>(
    "POST",
    "/api/workspaces/:id/reload",
  ),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
