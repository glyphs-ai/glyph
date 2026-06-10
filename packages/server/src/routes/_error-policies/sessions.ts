/**
 * Per-domain error policy for the sessions routes.
 *
 * These (class, status) pairs are the route contract. Name-equal
 * classes from other packages are deliberately not interchangeable.
 *
 * The session-package `AgentNotFoundError` is a distinct class from
 * the task / schedule / catalog variants of the same name; this
 * policy `instanceof`-matches the session-package class so the four
 * realm-specific status mappings stay independent (see the
 * cross-domain error contract test).
 *
 * `AgentResolutionFailedError` carries a deliberately opaque
 * class-stable body — its `cause` may contain DB host paths, stack
 * frames, or other internals. The real diagnostics land in the
 * server log via `logFault()`; the wire response is collapsed to
 * `{ error: "internal error", code: "AgentResolutionFailedError" }`.
 */

import {
  AgentNotFoundError,
  AgentResolutionFailedError,
  InvalidSessionIdError,
  RuntimeDoesNotSupportRemoteError,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
  SessionIdAllocationFailedError,
  SessionNotFoundError,
  TrustRegistrationFailed,
  UnknownRuntimeError,
} from "@glyphs-ai/session";
import type { ErrorPolicy } from "../_respond-error.js";
import { opaqueAgentResolutionBody } from "./_shared-bodies.js";

export const sessionsErrorPolicy: ErrorPolicy = {
  name: "sessions",
  statuses: [
    [InvalidSessionIdError, 400],
    [SessionNotFoundError, 404],
    [AgentNotFoundError, 400],
    [AgentResolutionFailedError, 500, opaqueAgentResolutionBody],
    [UnknownRuntimeError, 400],
    [RuntimeDoesNotSupportRemoteError, 400],
    [RuntimeStateDeletionFailed, 409],
    [SessionIdAllocationFailedError, 500],
    [RuntimeProvisionFailed, 500],
    [TrustRegistrationFailed, 500],
  ],
};
