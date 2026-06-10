/**
 * @glyphs-ai/session — per-session workdir manager.
 *
 * Each session is a provisioned workdir for one agent under one runtime
 * (e.g. copilot, gemini). Persistence is backed by Drizzle via a
 * per-workspace `workspace.db`. Activity (lastActiveAt, preview) is
 * read fresh from the runtime on every list/get call.
 *
 * The package's default `buildInteractiveLaunch()` returns a
 * shell-runnable `LaunchCommand` without touching any process. When a
 * `SpawnFn` is supplied to `composeSessionModule`, the same launch
 * command can be handed directly to that spawner via
 * `SessionService.spawnInteractive(id, opts)`. The session pkg never
 * value- or type-imports `@glyphs-ai/terminal`; the production
 * `SpawnFn` impl lives there and is wired by `composeApplication` in
 * `@glyphs-ai/api`.
 */

// Re-export runtime errors callers commonly want to catch alongside session errors.
export {
  RuntimeDoesNotSupportRemoteError,
  RuntimeProvisionFailed,
  RuntimeRefreshFailed,
  RuntimeStateDeletionFailed,
  TrustRegistrationFailed,
  UnknownRuntimeError,
} from "@glyphs-ai/runtime";
export {
  composeSessionModule,
  type SessionModule,
  type SessionModuleOptions,
} from "./compose.js";
export {
  AgentNotFoundError,
  AgentResolutionFailedError,
  InvalidSessionIdError,
  SessionError,
  SessionIdAllocationFailedError,
  SessionNotFoundError,
} from "./errors.js";
export type {
  AgentEntry,
  AgentResolverPort,
  SpawnFn,
  SpawnInteractiveResult,
} from "./ports.js";
// `SessionRow` (Drizzle `$inferSelect` alias) is intentionally NOT
// re-exported. It is an implementation detail of the persistence
// layer; external callers should consume the `Session` DTO below
// (built by `SessionService` from a row plus runtime metadata).
// `SessionRepository` is exported for tests and advanced diagnostics that
// need to assert on the persisted slice directly — production callers go
// through the service.
export {
  type FindAllSessionOpts,
  SessionRepository,
  type UpdateSessionPatch,
} from "./session-repository.js";
export { SessionService } from "./session-service.js";
export type {
  BuildInteractiveLaunchSessionOpts,
  CreateSessionOpts,
  DeleteSessionOpts,
  LaunchCommand,
  ListSessionOpts,
  Session,
  SessionServiceOpts,
  SpawnSessionResult,
} from "./types.js";
