/**
 * @glyphs-ai/workspace — workspace registry on Drizzle.
 *
 * A *workspace* is the user-chosen working directory that holds
 * glyph's per-workspace state. Each workspace is identified by an
 * opaque UUID `id` (the URL routing key) and lives at an absolute
 * filesystem `workspaceDir`. Display name + metadata live in the
 * global registry row (`global.db`).
 */

export {
  composeWorkspaceModule,
  type WorkspaceModule,
  type WorkspaceModuleOptions,
} from "./compose.js";
export {
  RegistryError,
  WorkspaceError,
  WorkspaceIdConflictError,
  WorkspaceIdInvalidError,
  WorkspaceNameInvalidError,
  WorkspaceNotRegisteredError,
  WorkspacePathConflictError,
  WorkspacePathInvalidError,
} from "./errors.js";
export {
  globalDbPath,
  type WorkspaceLayout,
  workspaceLayout,
  workspacesParentDir,
} from "./layout.js";
export type {
  ListWorkspacesOpts,
  RegisterWorkspaceOpts,
  RegisterWorkspaceResult,
  RenameWorkspaceOpts,
  UnregisterWorkspaceOpts,
  Workspace,
} from "./types.js";
export { InputValidationError } from "./validate.js";
export { WorkspaceService, type WorkspaceServiceOpts } from "./workspace-service.js";
