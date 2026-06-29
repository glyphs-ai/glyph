import type { ResultAsync } from "neverthrow";

/** Backing-store failure while provisioning or tearing down a workspace. */
export type ProvisioningFailed = {
  readonly type: "ProvisioningFailed";
  readonly workspaceDir: string;
  readonly cause: unknown;
};

/**
 * Lifecycle port for the workspace skeleton. It creates and removes
 * package-owned parent directories only; per-id contents belong to
 * consumer packages. Methods return `ResultAsync` and adapters map
 * backend failures to `ProvisioningFailed`.
 */
export interface WorkspaceProvisioner {
  /** Materialize the workspace skeleton idempotently. */
  provision(workspaceDir: string): ResultAsync<void, ProvisioningFailed>;

  /** Remove the managed skeleton idempotently, leaving `workspaceDir` intact. */
  teardown(workspaceDir: string): ResultAsync<void, ProvisioningFailed>;
}
