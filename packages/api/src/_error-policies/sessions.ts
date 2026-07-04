/**
 * Per-domain error response builder for the sessions routes.
 *
 * @glyphs-ai/session returns errors as discriminated-union values (not
 * thrown classes), so the route catches a `Result.Err` value and passes
 * it through {@link respondSessionError}. The status and wire `code`
 * derive from the value's `.type` discriminator; 5xx tech failures are
 * logged via `logFault` and collapsed to an opaque body so a `cause`
 * carrying DB internals or host paths never reaches the wire.
 *
 * Malformed path ids are a separate path: the use-case re-parses its
 * request through `SessionIdSchema` and a malformed id surfaces as a
 * thrown `ZodError` that `createApiApp`'s onError renders as a 400.
 */

import type {
  CreateSessionError,
  DeleteSessionError,
  GetSessionError,
  ListSessionsError,
} from "@glyphs-ai/session";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { logFault } from "../_http-errors.js";

/** Every DU error value a session route can surface from `.execute()`. */
export type SessionRouteError =
  | CreateSessionError
  | DeleteSessionError
  | GetSessionError
  | ListSessionsError;

type SessionErrorType = SessionRouteError["type"];

const STATUS_BY_TYPE: Readonly<Record<SessionErrorType, ContentfulStatusCode>> = {
  SessionNotFound: 404,
  AgentNotFound: 400,
  UnknownRuntime: 400,
  RuntimeStateDeletionFailed: 409,
  SandboxRemovalFailed: 409,
  AgentResolutionFailed: 500,
  SandboxProvisionFailed: 500,
  RuntimeProvisionFailed: 500,
  DatabaseUnavailable: 500,
};

const MESSAGE_BY_TYPE: Readonly<Record<SessionErrorType, string>> = {
  SessionNotFound: "session not found",
  AgentNotFound: "agent not found",
  UnknownRuntime: "unknown runtime",
  RuntimeStateDeletionFailed: "runtime state deletion failed",
  SandboxRemovalFailed: "sandbox removal failed",
  AgentResolutionFailed: "internal error",
  SandboxProvisionFailed: "internal error",
  RuntimeProvisionFailed: "internal error",
  DatabaseUnavailable: "internal error",
};

export interface RespondSessionErrorOpts {
  readonly route: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Render a session route's `Result.Err` DU value as an HTTP response:
 * status + `code = err.type` from the static tables above. 5xx tech
 * failures emit the structured `logFault` line; the wire body for those
 * is the opaque `"internal error"` message so a `cause` never leaks.
 */
export function respondSessionError(
  c: Context,
  err: SessionRouteError,
  opts: RespondSessionErrorOpts,
): Response {
  const status = STATUS_BY_TYPE[err.type];
  if (status >= 500) {
    logFault(c, err, `${opts.route}: 5xx fault`, opts.meta);
  }
  return c.json({ error: MESSAGE_BY_TYPE[err.type], code: err.type }, status);
}
