/**
 * Application barrel: shared value objects + error atoms referenced by
 * use-case error unions. Repository / sandbox / resolver atoms come from
 * their port files; the runtime atoms come from `@glyphs-ai/runtime`.
 * Entity, schema, mapper, and row types stay package-internal.
 */

export type {
  RuntimeLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
  UnknownRuntime,
} from "@glyphs-ai/runtime";
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
export type { AgentNotFound, AgentResolutionFailed } from "./ports/agent-resolver.js";
