import type { ResultAsync } from "neverthrow";
import type { SessionId } from "./session-id.js";

/** A session sandbox could not be provisioned (on `create`). */
export type SandboxProvisionFailed = {
  readonly type: "SandboxProvisionFailed";
  readonly cause: unknown;
};

/** A session sandbox could not be removed (on `delete --purge`). */
export type SandboxRemovalFailed = {
  readonly type: "SandboxRemovalFailed";
  readonly cause: unknown;
};

/**
 * Port for a session's isolated work environment — the place an agent's
 * product lives. Mechanism-agnostic: today a local directory under
 * `<workspaceDir>/sessions/<id>/`, tomorrow possibly a remote dir,
 * container volume, or cloud sandbox. Location is pure ({@link resolve}
 * returns the addressable path); only the IO (`create` / `remove`)
 * crosses the port. Callers decide whether a removal failure is fatal
 * (delete --purge) or best-effort (create rollback).
 */
export interface SessionSandbox {
  /** Addressable path of `id`'s sandbox (pure; stays under the sandbox root). */
  resolve(id: SessionId): string;
  /** Provision the per-session sandbox, creating the sandbox root if needed. */
  create(id: SessionId): ResultAsync<string, SandboxProvisionFailed>;
  /** Remove the per-session sandbox. */
  remove(id: SessionId): ResultAsync<void, SandboxRemovalFailed>;
}
