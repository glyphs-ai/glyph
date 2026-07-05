import { mkdir } from "node:fs/promises";
import { ResultAsync } from "neverthrow";
import type {
  ProvisioningFailed,
  WorkspaceProvisioner,
} from "../../domain/workspace-provisioner.js";

/**
 * Local filesystem adapter that ensures the workspace root directory
 * exists. The per-domain subdirs (`sessions/`, `tasks/`, `workflows/`)
 * are created lazily by their own packages, not here.
 */
export class LocalWorkspaceProvisioner implements WorkspaceProvisioner {
  provision(workspaceDir: string): ResultAsync<void, ProvisioningFailed> {
    return ResultAsync.fromPromise(
      mkdir(workspaceDir, { recursive: true }).then(() => undefined),
      (cause): ProvisioningFailed => ({ type: "ProvisioningFailed", workspaceDir, cause }),
    );
  }
}
