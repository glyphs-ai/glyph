/**
 * @glyphs-ai/workspace — workspace registry on Drizzle.
 *
 * A *workspace* is the user-chosen working directory that holds
 * glyph's per-workspace state. Each workspace is identified by an
 * opaque UUID `id` (the URL routing key) and lives at an absolute
 * filesystem `workspaceDir`. Display name + metadata live in the
 * global registry row (`global.db`).
 *
 * Architecture: composition root → `composeWorkspaceModule` returns a
 * {@link WorkspaceModule}, a typed container of use-case instances.
 * Consumers (HTTP routes, CLI, MCP) call
 * `module.<useCase>.execute(request)` directly.
 *
 * Layering invariant: this file imports ONLY from
 * `./application/*` and the package-root composition module. Domain
 * adapters and the persistence layer stay internal — `workspace-public`
 * is the application-layer barrel that re-exports the small set of
 * domain symbols (value objects, error DUs) that flow across the
 * package boundary.
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
// Schemas drive OpenAPI generation in @glyphs-ai/api; types align
// CLI / dashboard call sites. Use-case CLASSES and DEPS interfaces
// stay private — the module owns instantiation, callers consume
// instances through the module.
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
export {
  composeWorkspaceModule,
  type WorkspaceModule,
  type WorkspaceModuleOptions,
} from "./workspace-module.js";
