import type { ResultAsync } from "neverthrow";

/**
 * Returned by {@link WorkspaceProvisioner} when the backing store
 * cannot fulfil a provision / teardown (disk full, permission denied,
 * remote API unreachable). Generic by design — adapters surface a
 * single tech-failure variant rather than leaking backend-specific
 * codes; the HTTP layer maps it to a 500.
 */
export type ProvisioningFailed = {
  readonly type: "ProvisioningFailed";
  readonly workspaceDir: string;
  readonly cause: unknown;
};

/**
 * Lifecycle port for the physical container that backs a workspace.
 * Domain-owned interface the application depends on for provision /
 * teardown; concrete adapters (`LocalWorkspaceProvisioner` on
 * `node:fs`, future `K8sWorkspaceProvisioner` on PVCs, in-memory for
 * tests) live in `infrastructure/`.
 *
 * Scope: lifecycle only (create / destroy the workspace skeleton).
 * The provisioner does NOT read, write, or traverse workspace
 * contents — those belong to the T0/T1 packages (session, task,
 * workflow) that own their per-id leaves
 * (`<workspaceDir>/<role>/<id>/`). Workspace OWNS THE PARENT layout
 * (`sessions/`, `tasks/`, `workflows/`); consumer packages mkdir
 * their per-id leaves under it.
 *
 * Which subdirectories make up the skeleton is an implementation
 * detail of each adapter (local: the three parent dirs above; k8s:
 * PVCs etc), not part of this contract.
 *
 * Result/error contract: every method returns a `ResultAsync` —
 * adapters never throw. Backend failures collapse to
 * `ProvisioningFailed`.
 */
export interface WorkspaceProvisioner {
  /**
   * Materialize the workspace skeleton at `workspaceDir`. Must be
   * idempotent: repeated calls with the same arg succeed without
   * error so a mid-flight crash in `register` is recoverable by retry.
   */
  provision(workspaceDir: string): ResultAsync<void, ProvisioningFailed>;

  /**
   * Tear down the actively managed skeleton at `workspaceDir`.
   * Idempotent (missing paths are a no-op). The root `workspaceDir`
   * itself is left in place because the host may have placed unrelated
   * files there; the registry row is the source of truth for whether a
   * workspace is registered, not directory presence.
   */
  teardown(workspaceDir: string): ResultAsync<void, ProvisioningFailed>;
}
