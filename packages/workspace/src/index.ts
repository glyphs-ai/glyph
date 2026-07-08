/**
 * Workspace registry package. The public surface is use-case schemas,
 * use-case result types, shared value objects/errors, and the
 * `composeWorkspaceModule` composition root.
 */

export {
  type GetLastOpenedWorkspaceError,
  type GetLastOpenedWorkspaceRequest,
  GetLastOpenedWorkspaceRequestSchema,
  type GetLastOpenedWorkspaceResponse,
  GetLastOpenedWorkspaceResponseSchema,
} from "./application/get-last-opened-workspace.js";
export {
  type GetLastOpenedWorkspaceIdError,
  type GetLastOpenedWorkspaceIdRequest,
  GetLastOpenedWorkspaceIdRequestSchema,
  type GetLastOpenedWorkspaceIdResponse,
  GetLastOpenedWorkspaceIdResponseSchema,
} from "./application/get-last-opened-workspace-id.js";
export {
  type GetWorkspaceError,
  type GetWorkspaceRequest,
  GetWorkspaceRequestSchema,
  type GetWorkspaceResponse,
  GetWorkspaceResponseSchema,
} from "./application/get-workspace.js";
export {
  type ListWorkspacesError,
  type ListWorkspacesRequest,
  ListWorkspacesRequestSchema,
  type ListWorkspacesResponse,
  ListWorkspacesResponseSchema,
} from "./application/list-workspaces.js";
export {
  type OpenWorkspaceError,
  type OpenWorkspaceRequest,
  OpenWorkspaceRequestSchema,
  type OpenWorkspaceResponse,
  OpenWorkspaceResponseSchema,
} from "./application/open-workspace.js";
// ─── Per-use-case wire contracts ─────────────────────────────────
// Schemas drive OpenAPI generation; use-case classes stay private.
export {
  type RegisterWorkspaceError,
  type RegisterWorkspaceRequest,
  RegisterWorkspaceRequestSchema,
  type RegisterWorkspaceResponse,
  RegisterWorkspaceResponseSchema,
} from "./application/register-workspace.js";
export {
  type RenameWorkspaceError,
  type RenameWorkspaceRequest,
  RenameWorkspaceRequestSchema,
  type RenameWorkspaceResponse,
  RenameWorkspaceResponseSchema,
} from "./application/rename-workspace.js";
export {
  type UnregisterWorkspaceError,
  type UnregisterWorkspaceRequest,
  UnregisterWorkspaceRequestSchema,
  type UnregisterWorkspaceResponse,
  UnregisterWorkspaceResponseSchema,
} from "./application/unregister-workspace.js";
// ─── Shared cross-use-case surface (re-exported from domain) ─────
export * from "./application/workspace-public.js";
// ─── Composition root ────────────────────────────────────────────
export type { Db } from "./infrastructure/drizzle/workspace-db.js";
export { applyWorkspaceMigrations } from "./infrastructure/drizzle/workspace-migrations.js";
export {
  composeWorkspaceModule,
  type WorkspaceModule,
  type WorkspaceModuleOptions,
} from "./workspace-module.js";
