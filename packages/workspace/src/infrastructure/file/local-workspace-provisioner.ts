import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type {
  ProvisioningFailed,
  WorkspaceProvisioner,
} from "../../domain/workspace-provisioner.js";

/**
 * Local filesystem adapter for the workspace skeleton: `sessions/`,
 * `tasks/`, and `workflows/` under `workspaceDir`.
 */
export class LocalWorkspaceProvisioner implements WorkspaceProvisioner {
  private static skeleton(workspaceDir: string): {
    sessions: string;
    tasks: string;
    workflows: string;
  } {
    const root = path.resolve(workspaceDir);
    return {
      sessions: path.join(root, "sessions"),
      tasks: path.join(root, "tasks"),
      workflows: path.join(root, "workflows"),
    };
  }

  private static asProvisioningFailed(
    workspaceDir: string,
  ): (cause: unknown) => ProvisioningFailed {
    return (cause) => ({ type: "ProvisioningFailed", workspaceDir, cause });
  }

  provision(workspaceDir: string): ResultAsync<void, ProvisioningFailed> {
    const { sessions, tasks, workflows } = LocalWorkspaceProvisioner.skeleton(workspaceDir);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(workspaceDir, { recursive: true });
        await Promise.all([
          mkdir(sessions, { recursive: true }),
          mkdir(tasks, { recursive: true }),
          mkdir(workflows, { recursive: true }),
        ]);
      })(),
      LocalWorkspaceProvisioner.asProvisioningFailed(workspaceDir),
    );
  }

  teardown(workspaceDir: string): ResultAsync<void, ProvisioningFailed> {
    const { sessions, tasks, workflows } = LocalWorkspaceProvisioner.skeleton(workspaceDir);
    return ResultAsync.fromPromise(
      Promise.all([
        rm(sessions, { recursive: true, force: true }),
        rm(tasks, { recursive: true, force: true }),
        rm(workflows, { recursive: true, force: true }),
      ]).then(() => undefined),
      LocalWorkspaceProvisioner.asProvisioningFailed(workspaceDir),
    );
  }
}
