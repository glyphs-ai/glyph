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
export function buildWorkspaceLayout(workspaceDir: string): WorkspaceLayout {
  const root = path.resolve(workspaceDir);
  return {
    sessions: path.join(root, "sessions"),
    tasks: path.join(root, "tasks"),
    workflows: path.join(root, "workflows"),
  };
}
