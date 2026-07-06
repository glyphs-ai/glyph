/**
 * Problem table for the workspaces routes.
 *
 * @glyphs-ai/workspace returns errors as discriminated-union values (not
 * thrown classes), so the route catches a `Result.Err` value and passes
 * it through {@link respondWorkspaceError}. Status + `title` derive from
 * the value's `.type` discriminator via {@link WORKSPACE_TABLE}.
 *
 * `WorkspaceHasLiveTasksError` is API-owned (lives in
 * `workspace-context.ts`) and still flows as a thrown class; its class
 * `.name` matches the same-named table row, so the responder renders it
 * without a separate class-policy branch.
 */

import type {
  DatabaseUnavailable,
  ProvisioningFailed,
  WorkspaceError,
  WorkspaceNotFound,
  WorkspacePathConflict,
} from "@glyphs-ai/workspace";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ProblemTable } from "../_http-errors.js";
import { respondProblem } from "../_http-errors.js";
import type { WorkspaceHasLiveTasksError } from "../workspace-context.js";

/**
 * Closed union of every error value a workspace route may surface. The
 * first three are domain DU values from @glyphs-ai/workspace;
 * `WorkspaceHasLiveTasksError` is a thrown class owned by api itself.
 */
export type WorkspaceRouteError = WorkspaceError | ProvisioningFailed | WorkspaceHasLiveTasksError;

interface WorkspaceDef {
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly detail: (err: WorkspaceRouteError) => string;
}

type WorkspaceCode =
  | WorkspaceNotFound["type"]
  | WorkspacePathConflict["type"]
  | DatabaseUnavailable["type"]
  | ProvisioningFailed["type"]
  | "WorkspaceHasLiveTasksError";

const WORKSPACE_TABLE: Readonly<Record<WorkspaceCode, WorkspaceDef>> = {
  WorkspaceNotFound: {
    status: 404,
    title: "Workspace not found",
    detail: () => "workspace not found",
  },
  WorkspacePathConflict: {
    status: 409,
    title: "Workspace path conflict",
    detail: () => "workspace directory already registered",
  },
  DatabaseUnavailable: { status: 503, title: "Internal error", detail: () => "internal error" },
  ProvisioningFailed: { status: 500, title: "Internal error", detail: () => "internal error" },
  WorkspaceHasLiveTasksError: {
    status: 409,
    title: "Workspace has live tasks",
    detail: (err) => (err as WorkspaceHasLiveTasksError).message,
  },
};

/** Workspace Problem table, keyed by DU `type` (and the one class `name`). */
export const workspaceTable: ProblemTable = WORKSPACE_TABLE as unknown as ProblemTable;

export interface RespondWorkspaceErrorOpts {
  readonly route: string;
  readonly meta?: Record<string, unknown>;
  /** Status for an error with no matching table row. Defaults to 500. */
  readonly defaultStatus?: ContentfulStatusCode;
}

/**
 * Render a workspace route's error as an `application/problem+json`
 * response. Accepts either a `Result.Err` DU value or the api-owned
 * `WorkspaceHasLiveTasksError` class — both resolve against
 * {@link workspaceTable}. Unrecognised errors collapse to an opaque 500.
 * 5xx tech failures are logged + collapsed by `respondProblem`.
 */
export function respondWorkspaceError(
  c: Context,
  err: unknown,
  opts: RespondWorkspaceErrorOpts,
): Response {
  return respondProblem(c, err, workspaceTable, {
    route: opts.route,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    defaultStatus: opts.defaultStatus ?? 500,
  });
}
