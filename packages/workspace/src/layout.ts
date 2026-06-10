import path from "node:path";

/**
 * Conventional sub-path layout under a workspace's `workspaceDir`.
 *
 * This T0 package actively manages only `sessions/` and `tasks/`;
 * `workflows/` is exposed as a conventional path for the T1
 * `@glyphs-ai/workflow` package. `register` does not create it and
 * `unregister({ purge: true })` does not delete it.
 */
export interface WorkspaceLayout {
  readonly sessions: string;
  readonly tasks: string;
  readonly workflows: string;
}

/**
 * Compute the conventional sub-path layout under `workspaceDir`. Pure
 * function; no fs side effects. `WorkspaceService` uses the
 * `sessions/` and `tasks/` paths for `register` and
 * `unregister({ purge: true })`; T1 workflow code owns the returned
 * `workflows/` path.
 */
export function workspaceLayout(workspaceDir: string): WorkspaceLayout {
  const root = path.resolve(workspaceDir);
  return {
    sessions: path.join(root, "sessions"),
    tasks: path.join(root, "tasks"),
    workflows: path.join(root, "workflows"),
  };
}

// ─── Global (under GLYPH_HOME) ──────────────────────────────

/**
 * Filename (under `<home>`) for the global SQLite database. Holds the
 * workspace registry and other cross-workspace state. Per-workspace
 * data lives in each workspace's own `workspace.db`, not here.
 */
export const GLOBAL_DB_FILE = "global.db";

/**
 * Subdirectory (under `<home>`) where the server auto-allocates new
 * workspace directories when the user creates a workspace without
 * specifying a `workspaceDir`. Each auto-allocated workspace lives at
 * `<home>/workspaces/<uuid>/`.
 */
export const WORKSPACES_PARENT_SUBDIR = "workspaces";

/** Resolve `<home>/global.db`. */
export function globalDbPath(home: string): string {
  return path.join(home, GLOBAL_DB_FILE);
}

/** Resolve `<home>/workspaces/`. */
export function workspacesParentDir(home: string): string {
  return path.join(home, WORKSPACES_PARENT_SUBDIR);
}
