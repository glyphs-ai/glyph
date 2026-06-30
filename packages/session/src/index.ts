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
 *   - Curated domain surface via `./application/index.js`: the branded
 *     `SessionId` + schema and the error atoms the use-case error
 *     unions are built from.
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
export type { LaunchCommand, ResolvedAgent } from "@glyphs-ai/runtime-v2";
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
// ─── curated domain surface (SessionId, error atoms) ───────────────
// Funnelled through the application barrel so this file never mentions
// `./domain/*` directly — domain stays private to the package.
export * from "./application/index.js";
export {
  type ListSessionsError,
  type ListSessionsRequest,
  ListSessionsRequestSchema,
  type ListSessionsResponse,
  ListSessionsResponseSchema,
} from "./application/list-sessions.js";
// ─── host-supplied ports ───────────────────────────────────────────
export type { AgentResolver } from "./application/ports/agent-resolver.js";
export {
  type SpawnInteractiveError,
  type SpawnInteractiveRequest,
  SpawnInteractiveRequestSchema,
  type SpawnInteractiveResponse,
  SpawnInteractiveResponseSchema,
} from "./application/spawn-interactive.js";
// ─── use-case contract ─────────────────────────────────────────────
export type { UseCase, UseCaseResult } from "./application/use-case.js";
export {
  composeSessionModule,
  type SessionModule,
  type SessionModuleOptions,
} from "./session-module.js";
