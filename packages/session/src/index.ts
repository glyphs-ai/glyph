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
  RuntimeStateDeletionFailed,
  TrustRegistrationFailed,
  UnknownRuntimeError,
} from "@glyphs-ai/runtime";
export { composeSessionModule } from "./compose.js";
export {
  AgentNotFoundError,
  AgentResolutionFailedError,
  InvalidSessionIdError,
  SessionIdAllocationFailedError,
  SessionNotFoundError,
  SessionPathEscapeError,
  SpawnFnNotInjectedError,
} from "./errors.js";
export type { SpawnFn } from "./ports.js";
export { SessionService } from "./session-service.js";
export type {
  LaunchCommand,
  Session,
  SessionServiceOpts,
  SpawnSessionResult,
} from "./types.js";
