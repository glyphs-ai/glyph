/**
 * @glyphs-ai/workspace — workspace registry on Drizzle.
 *
 * A *workspace* is the user-chosen working directory that holds
 * glyph's per-workspace state. Each workspace is identified by an
 * opaque UUID `id` (the URL routing key) and lives at an absolute
 * filesystem `workspaceDir`. Display name + metadata live in the
 * global registry row (`global.db`).
 */

export { WorkspaceService, type WorkspaceServiceOpts } from "./application/workspace.service.js";
export {
  composeWorkspaceModule,
  type WorkspaceModule,
  type WorkspaceModuleOptions,
} from "./workspace.compose.js";
