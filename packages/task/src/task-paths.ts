/**
 * On-disk task layout contract.
 *
 * A task's workdir lives at `<workspaceDir>/tasks/<taskId>/`; user-visible
 * output goes under the `artifact/` subdir. The local file sandbox
 * materializes this layout, and hosts that resolve task artifact paths off
 * the module boundary (e.g. the workflow artifacts route, which lists a
 * node's task artifacts) read the same contract from here — so the layout
 * has one source of truth rather than being duplicated in the host.
 */

import path from "node:path";

const TASKS_SUBDIR = "tasks";

/** The subdir under each task workdir holding user-visible output files. */
export const TASK_ARTIFACT_SUBDIR = "artifact";

/** Absolute root dir for a workspace's per-task workdirs (`<workspaceDir>/tasks`). */
export function tasksRoot(workspaceDir: string): string {
  return path.join(workspaceDir, TASKS_SUBDIR);
}
