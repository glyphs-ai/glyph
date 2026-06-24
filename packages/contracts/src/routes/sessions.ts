/**
 * Session routes (workspace-scoped) plus their request / response wire
 * shapes. Sessions are interactive; the spawn route hands the client a
 * terminal-launch descriptor.
 */

import type { Session } from "@glyphs-ai/session";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";
import type { WorkspacePathParams } from "./workspaces.js";

/** GET /api/workspaces/:id/sessions query params. ISO 8601 timestamps. */
export interface SessionListQuery {
  readonly agent?: string;
  readonly createdSince?: string;
  readonly activeSince?: string;
}

/** POST /api/workspaces/:id/sessions body. */
export interface SessionCreateBody {
  readonly agent: string;
  readonly runtime?: string;
}

/** DELETE /api/workspaces/:id/sessions/:sid query params. `1` = enabled. */
export interface SessionDeleteQuery {
  readonly purge?: "1";
}

/** POST /api/workspaces/:id/sessions/:sid/spawn body. */
export interface SessionSpawnBody {
  /** When `true`, build a remote-launch command instead of a local one. */
  readonly remote?: boolean;
}

/** Response from the spawn route. Indicates whether terminal launch succeeded. */
export type SessionSpawnRes =
  | { readonly ok: true; readonly launcher: string; readonly display: string }
  | { readonly ok: false; readonly error: string; readonly code: string; readonly display: string };

/** Session-scoped path params. */
export interface SessionPathParams {
  readonly id: string;
  readonly sid: string;
}

export const sessionRoutes = {
  "sessions.list": defineRoute<
    { params: WorkspacePathParams; query: SessionListQuery },
    readonly Session[]
  >("GET", "/api/workspaces/:id/sessions"),
  "sessions.create": defineRoute<{ params: WorkspacePathParams; body: SessionCreateBody }, Session>(
    "POST",
    "/api/workspaces/:id/sessions",
  ),
  "sessions.get": defineRoute<{ params: SessionPathParams }, Session>(
    "GET",
    "/api/workspaces/:id/sessions/:sid",
  ),
  "sessions.delete": defineRoute<{ params: SessionPathParams; query: SessionDeleteQuery }, void>(
    "DELETE",
    "/api/workspaces/:id/sessions/:sid",
  ),
  "sessions.spawn": defineRoute<
    { params: SessionPathParams; body: SessionSpawnBody },
    SessionSpawnRes
  >("POST", "/api/workspaces/:id/sessions/:sid/spawn"),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
