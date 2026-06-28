/**
 * Per-domain error policy for the workspaces routes.
 *
 * These (class, status) pairs are the route contract. The
 * `WorkspaceHasLiveTasksError` mapping belongs here so every workspace
 * route uses one policy surface.
 *
 * Read routes pass `defaultStatus: 500` for unmapped faults; mutate
 * routes use the policy default of 400 for caller-fixable fallthroughs.
 */

import {
  RegistryError,
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
} from "@glyphs-ai/workspace/contract";
import type { ErrorPolicy } from "../_http-errors.js";
import { WorkspaceHasLiveTasksError } from "../workspace-context.js";

export const workspacesErrorPolicy: ErrorPolicy = {
  name: "workspaces",
  statuses: [
    [WorkspaceNotRegisteredError, 404],
    [WorkspaceIdConflictError, 409],
    [WorkspacePathConflictError, 409],
    [WorkspaceHasLiveTasksError, 409],
    // Input *format* errors are not here — the service raises them as
    // ZodError, which `respondError` maps to a 400 `ValidationError`
    // envelope before policy resolution. The entries below are
    // precondition / conflict errors.
    //
    // RegistryError and WorkspaceError are abstract bases for several
    // of the entries above (RegistryError ⊃ WorkspaceIdConflictError /
    // WorkspacePathConflictError / WorkspaceNotRegisteredError;
    // WorkspaceError ⊃ everything in @glyphs-ai/workspace). Listed LAST
    // so concrete subclasses match first; un-subclassed registry /
    // workspace errors are 500s.
    [RegistryError, 500],
    [WorkspaceError, 500],
  ],
};
