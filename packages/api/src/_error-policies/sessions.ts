/**
 * Problem table for the sessions routes.
 *
 * @glyphs-ai/session returns errors as discriminated-union values (not
 * thrown classes), so the route catches a `Result.Err` value and passes
 * it through {@link respondSessionError}. Status + `title` derive from the
 * value's `.type` discriminator via {@link SESSION_TABLE}; 5xx tech
 * failures collapse to the opaque `"internal error"` detail so a `cause`
 * carrying DB internals or host paths never reaches the wire.
 *
 * Malformed path ids are a separate path: the use-case re-parses its
 * request through `SessionIdSchema` and a malformed id surfaces as a
 * thrown `ZodError` that `respondProblem` renders as a 400 ValidationError.
 */

import type {
  CreateSessionError,
  DeleteSessionError,
  GetSessionError,
  ListSessionsError,
} from "@glyphs-ai/session";
import type { Context } from "hono";
import type { DomainProblemTable, ProblemTable } from "../_http-errors.js";
import { respondProblem } from "../_http-errors.js";

/** Every DU error value a session route can surface from `.execute()`. */
export type SessionRouteError =
  | CreateSessionError
  | DeleteSessionError
  | GetSessionError
  | ListSessionsError;

const INTERNAL = "internal error";

export const SESSION_TABLE = {
  SessionNotFound: { status: 404, title: "Session not found", detail: () => "session not found" },
  AgentNotFound: { status: 400, title: "Agent not found", detail: () => "agent not found" },
  UnknownRuntime: { status: 400, title: "Unknown runtime", detail: () => "unknown runtime" },
  RuntimeStateDeletionFailed: {
    status: 409,
    title: "Runtime state deletion failed",
    detail: () => "runtime state deletion failed",
  },
  SandboxRemovalFailed: {
    status: 409,
    title: "Sandbox removal failed",
    detail: () => "sandbox removal failed",
  },
  AgentResolutionFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
  SandboxProvisionFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
  RuntimeProvisionFailed: { status: 500, title: "Internal error", detail: () => INTERNAL },
  DatabaseUnavailable: { status: 500, title: "Internal error", detail: () => INTERNAL },
} satisfies DomainProblemTable<SessionRouteError>;

export interface RespondSessionErrorOpts {
  readonly route: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Render a session route's `Result.Err` DU value as an
 * `application/problem+json` response: status + `title` from
 * {@link SESSION_TABLE}, `detail` from the row's builder. 5xx tech failures
 * are logged + collapsed to the opaque detail by `respondProblem`.
 */
export function respondSessionError(
  c: Context,
  err: SessionRouteError,
  opts: RespondSessionErrorOpts,
): Response {
  return respondProblem(c, err, SESSION_TABLE as ProblemTable, {
    route: opts.route,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
  });
}
