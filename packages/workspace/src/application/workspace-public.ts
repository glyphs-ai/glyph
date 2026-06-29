/** Public value objects and errors shared across workspace use-cases. */

// ─── Value objects ───────────────────────────────────────────────
export { type WorkspaceId, WorkspaceIdSchema } from "../domain/workspace-id.js";
export { type WorkspaceName, WorkspaceNameSchema } from "../domain/workspace-name.js";
export type { ProvisioningFailed } from "../domain/workspace-provisioner.js";
// ─── Errors ──────────────────────────────────────────────────────
export type {
  DatabaseUnavailable,
  WorkspaceIdConflict,
  WorkspaceNotRegistered,
  WorkspacePathConflict,
} from "../domain/workspace-repository.js";

import type { ProvisioningFailed } from "../domain/workspace-provisioner.js";
import type {
  DatabaseUnavailable,
  WorkspaceIdConflict,
  WorkspaceNotRegistered,
  WorkspacePathConflict,
} from "../domain/workspace-repository.js";

/** Closed union of every error a workspace use-case can yield. */
export type WorkspaceError =
  | WorkspaceIdConflict
  | WorkspacePathConflict
  | WorkspaceNotRegistered
  | DatabaseUnavailable
  | ProvisioningFailed;
