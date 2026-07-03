/**
 * Public domain surface shared across session use-cases: the branded
 * `SessionId` + schema and the domain error atoms that use-case error unions
 * are built from. Application-layer atoms (agent resolution) and the runtime
 * error atoms are exposed from the package root (`../index.ts`). Entity,
 * schema, mapper, and row types stay package-internal.
 */

export { type SessionId, SessionIdSchema } from "../domain/session-id.js";
export type {
  DatabaseUnavailable,
  SessionIdConflict,
  SessionNotFound,
} from "../domain/session-repository.js";
export type {
  SandboxProvisionFailed,
  SandboxRemovalFailed,
} from "../domain/session-sandbox.js";
