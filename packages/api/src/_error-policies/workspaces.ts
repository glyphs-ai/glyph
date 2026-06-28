/**
 * Per-domain error response builder for the workspaces routes.
 *
 * @glyphs-ai/workspace returns errors as discriminated-union values
 * (not thrown classes), so the route catches a `Result.Err` value and
 * passes it through {@link respondWorkspaceError} below. The status
 * and wire `code` derive from the value's `.type` discriminator.
 *
 * `WorkspaceHasLiveTasksError` is API-owned (lives in
 * `workspace-context.ts`) and still flows as a thrown class — the
 * helper accepts either a DU value or a thrown error and routes both.
 */

import type {
  DatabaseUnavailable,
  ProvisioningFailed,
  WorkspaceError,
  WorkspaceIdConflict,
  WorkspaceNotRegistered,
  WorkspacePathConflict,
} from "@glyphs-ai/workspace";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { logFault, type RespondErrorOpts, respondError } from "../_http-errors.js";
import { WorkspaceHasLiveTasksError } from "../workspace-context.js";

/**
 * Closed union of every error value a workspace route may need to
 * surface. The first three are domain DU values from @glyphs-ai/workspace;
 * `WorkspaceHasLiveTasksError` is a thrown class owned by api itself.
 */
export type WorkspaceRouteError = WorkspaceError | ProvisioningFailed | WorkspaceHasLiveTasksError;

const STATUS_BY_TYPE: Readonly<
  Record<
    | WorkspaceIdConflict["type"]
    | WorkspacePathConflict["type"]
    | WorkspaceNotRegistered["type"]
    | DatabaseUnavailable["type"]
    | ProvisioningFailed["type"],
    ContentfulStatusCode
  >
> = {
  WorkspaceNotRegistered: 404,
  WorkspaceIdConflict: 409,
  WorkspacePathConflict: 409,
  DatabaseUnavailable: 500,
  ProvisioningFailed: 500,
};

const MESSAGE_BY_TYPE: Readonly<
  Record<
    | WorkspaceIdConflict["type"]
    | WorkspacePathConflict["type"]
    | WorkspaceNotRegistered["type"]
    | DatabaseUnavailable["type"]
    | ProvisioningFailed["type"],
    string
  >
> = {
  WorkspaceNotRegistered: "workspace not registered",
  WorkspaceIdConflict: "workspace id already registered",
  WorkspacePathConflict: "workspace directory already registered",
  DatabaseUnavailable: "internal error",
  ProvisioningFailed: "internal error",
};

/**
 * Type guard for workspace DU values. We treat anything with a string
 * `type` matching one of the known discriminators as a DU; everything
 * else (including class instances) falls through to {@link respondError}.
 */
function isWorkspaceDuValue(err: unknown): err is WorkspaceError | ProvisioningFailed {
  if (typeof err !== "object" || err === null) return false;
  const t = (err as { type?: unknown }).type;
  return typeof t === "string" && t in STATUS_BY_TYPE;
}

export interface RespondWorkspaceErrorOpts {
  readonly route: string;
  readonly meta?: Record<string, unknown>;
  /**
   * Fallback for class-based errors that aren't workspace DUs (e.g.
   * `WorkspaceHasLiveTasksError`). Same shape as
   * {@link RespondErrorOpts.defaultStatus}.
   */
  readonly defaultStatus?: ContentfulStatusCode;
}

/**
 * Centralised response builder for workspace routes. Accepts either a
 * `Result.Err` DU payload or a thrown class instance:
 *
 *   - DU value (`WorkspaceError | ProvisioningFailed`) → status +
 *     `code = err.type` derived from the static tables above.
 *   - `WorkspaceHasLiveTasksError` (class) → routed through the
 *     legacy `respondError` policy.
 *   - Anything else → 500 via `respondError` with the same policy.
 *
 * 5xx tech failures (`DatabaseUnavailable`, `ProvisioningFailed`) emit
 * the same structured `logFault` line as the class-based path so log
 * coverage stays uniform.
 */
export function respondWorkspaceError(
  c: Context,
  err: unknown,
  opts: RespondWorkspaceErrorOpts,
): Response {
  if (isWorkspaceDuValue(err)) {
    // `isWorkspaceDuValue` checks the type tag against STATUS_BY_TYPE
    // keys; the lookups below are non-null by construction.
    const status = STATUS_BY_TYPE[err.type]!;
    const message = MESSAGE_BY_TYPE[err.type]!;
    if (status >= 500) {
      logFault(c, err, `${opts.route}: 5xx fault`, opts.meta);
    }
    return c.json({ error: message, code: err.type }, status);
  }
  return respondError(c, err, {
    route: opts.route,
    policy: workspacesClassErrorPolicy,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    ...(opts.defaultStatus !== undefined ? { defaultStatus: opts.defaultStatus } : {}),
  } satisfies RespondErrorOpts);
}

/**
 * Class-based error policy for the api-owned errors that still flow
 * as `throw` (`WorkspaceHasLiveTasksError`). Kept narrow on purpose:
 * the workspace pkg's own errors are DU values and bypass this map.
 */
const workspacesClassErrorPolicy = {
  name: "workspaces",
  statuses: [[WorkspaceHasLiveTasksError, 409]],
} as const;
