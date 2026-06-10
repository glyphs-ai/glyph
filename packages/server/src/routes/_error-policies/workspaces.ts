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

import { WorkspaceHasLiveTasksError } from "@glyphs-ai/api";
import {
  InputValidationError,
  RegistryError,
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceIdInvalidError,
  WorkspaceNameInvalidError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
} from "@glyphs-ai/workspace";
import type { ErrorPolicy } from "../_respond-error.js";

export const workspacesErrorPolicy: ErrorPolicy = {
  name: "workspaces",
  statuses: [
    [WorkspaceNameInvalidError, 400],
    [WorkspaceIdInvalidError, 400],
    [WorkspaceNotRegisteredError, 404],
    [WorkspaceIdConflictError, 409],
    [WorkspacePathConflictError, 409],
    [WorkspaceHasLiveTasksError, 409],
    [InputValidationError, 400],
    // RegistryError and WorkspaceError are abstract bases for several
    // of the entries above (RegistryError ⊃ WorkspaceIdConflictError /
    // WorkspaceIdInvalidError / WorkspacePathConflictError /
    // WorkspaceNotRegisteredError; WorkspaceError ⊃ everything in
    // @glyphs-ai/workspace). Listed LAST so concrete subclasses match
    // first; un-subclassed registry / workspace errors are 500s.
    [RegistryError, 500],
    [WorkspaceError, 500],
  ],
};
