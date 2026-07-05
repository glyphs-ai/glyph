import type { ResultAsync } from "neverthrow";

/** Backing-store failure while provisioning or tearing down a workspace. */
export type ProvisioningFailed = {
  readonly type: "ProvisioningFailed";
  readonly workspaceDir: string;
  readonly cause: unknown;
};

/**
 * Lifecycle port for the workspace root directory. `provision` ensures
 * `workspaceDir` exists so a bad path fails fast at registration; the
 * per-domain subdirs (`sessions/`, `tasks/`, `workflows/`) are created
 * lazily by their own packages. Adapters map backend failures to
 * `ProvisioningFailed`.
 */
export interface WorkspaceProvisioner {
  /** Ensure the workspace root directory exists (idempotent). */
  provision(workspaceDir: string): ResultAsync<void, ProvisioningFailed>;
}
