/**
 * Cross-use-case public surface — re-exports of domain symbols that
 * leave the package through `index.ts`. Use-case files import from
 * `../domain/...` directly (intra-package code freely consumes its
 * own domain); this barrel exists so the package's `index.ts` only
 * mentions `./application/*` paths, making "domain is private to
 * the package" visible in a single audit step.
 *
 * Add here only when a domain symbol must escape the package because
 * a wire contract or error policy references it. Internal-only
 * domain types (entity, repository port, provisioner port, mapper)
 * are not re-exported and stay invisible to callers.
 */

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

/**
 * Closed union of every error a workspace use-case can yield.
 * Consumers wanting a generic catch (e.g. the HTTP error policy)
 * depend on this; per-use-case errors carry only the subset their
 * operation can produce.
 */
export type WorkspaceError =
  | WorkspaceIdConflict
  | WorkspacePathConflict
  | WorkspaceNotRegistered
  | DatabaseUnavailable
  | ProvisioningFailed;
