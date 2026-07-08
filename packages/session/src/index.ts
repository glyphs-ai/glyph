/**
 * Public surface of @glyphs-ai/session.
 *
 * A session is a runtime-provisioned workdir for one catalog agent,
 * persisted in the per-workspace `workspace.db`. Schema-first,
 * Result-based, discriminated-union errors, no throws across the
 * package boundary. Every use-case implements
 * `UseCase<Request, Response, Error>` and returns
 * `UseCaseResult = ResultAsync<Response, Error>`.
 *
 * Exports:
 *   - Per use-case: its `Request` / `Response` Zod schemas + inferred
 *     types and `Error` union — the wire contract.
 *   - Curated domain surface via `./application/session-public.js`: the
 *     branded `SessionId` + schema and the domain error atoms the use-case
 *     error unions are built from. Application-layer + runtime error atoms
 *     (agent resolution / runtime) are exported directly from this file.
 *   - The host-supplied port (`AgentResolver`) and the runtime/terminal
 *     data types adapter authors need (`LaunchCommand`, `ResolvedAgent`).
 *   - `composeSessionModule` → `SessionModule`: the DI container a host
 *     builds once and dispatches through.
 *
 * NOT exported (package-internal): use-case classes + their `Deps`,
 * `SessionEntity`, repository / sandbox ports, drizzle schema
 * / mapper / row types, and the drizzle + file adapters —
 * hosts construct and call everything through `composeSessionModule`.
 *
 * Tier role: T1 (mode). No HTTP, no global state.
 */

// ─── runtime data types re-exported for adapter authors ────────────
export type {
  LaunchCommand,
  ResolvedAgent,
  RuntimeLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
  UnknownRuntime,
} from "@glyphs-ai/runtime";
// ─── use-case wire contracts ───────────────────────────────────────
export {
  type BuildInteractiveLaunchError,
  type BuildInteractiveLaunchRequest,
  BuildInteractiveLaunchRequestSchema,
  type BuildInteractiveLaunchResponse,
} from "./application/build-interactive-launch.js";
export {
  type CreateSessionError,
  type CreateSessionRequest,
  CreateSessionRequestSchema,
  type CreateSessionResponse,
  CreateSessionResponseSchema,
} from "./application/create-session.js";
export {
  type DeleteSessionError,
  type DeleteSessionRequest,
  DeleteSessionRequestSchema,
  type DeleteSessionResponse,
  DeleteSessionResponseSchema,
} from "./application/delete-session.js";
export {
  type GetSessionError,
  type GetSessionRequest,
  GetSessionRequestSchema,
  type GetSessionResponse,
  GetSessionResponseSchema,
} from "./application/get-session.js";
export {
  type ListSessionsError,
  type ListSessionsRequest,
  ListSessionsRequestSchema,
  type ListSessionsResponse,
  ListSessionsResponseSchema,
} from "./application/list-sessions.js";
// ─── host-supplied ports ───────────────────────────────────────────
export type {
  AgentNotFound,
  AgentResolver,
  AgentUnresolvable,
} from "./application/ports/agent-resolver.js";
// ─── curated domain surface (SessionId, error atoms) ───────────────
// Funnelled through session-public so this file never mentions
// `./domain/*` directly — domain stays private to the package.
export * from "./application/session-public.js";
export {
  type SpawnInteractiveError,
  type SpawnInteractiveRequest,
  SpawnInteractiveRequestSchema,
  type SpawnInteractiveResponse,
  SpawnInteractiveResponseSchema,
} from "./application/spawn-interactive.js";
// ─── use-case contract ─────────────────────────────────────────────
export type { UseCase, UseCaseResult } from "./application/use-case.js";
// ─── infrastructure seams (shared-db support) ──────────────────────
export type { Db } from "./infrastructure/drizzle/session-db.js";
export * as schema from "./infrastructure/drizzle/session-db.js";
export { applySessionMigrations } from "./infrastructure/drizzle/session-migrations.js";
export { createSessionScope, type SessionScope } from "./infrastructure/drizzle/session-scope.js";
export {
  composeSessionModule,
  type SessionModule,
  type SessionModuleOptions,
} from "./session-module.js";
