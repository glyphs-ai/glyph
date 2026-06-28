/**
 * Public surface of @glyphs-ai/catalogv2.
 *
 * Schema-first, Result-based, DU errors, no throws across the package
 * boundary. Every use-case implements `UseCase<Request, Response, Error>`
 * and returns `UseCaseResult = Promise<Result<Response, Error>>`.
 *
 * Exported buckets:
 *   1. Branded ids — `AgentId`, `SkillId` + constructors.
 *   2. Domain ports — `Source<T>`, `AgentRepository`,
 *      `SkillRepository`. Domain-owned interfaces; infrastructure
 *      provides adapters. (Note: `Fetcher` is an infra-internal
 *      composability abstraction, NOT a port — it lives in
 *      `infrastructure/` and is not part of the public surface.
 *      Hosts wire `MarkdownAgentSource` by passing a
 *      structurally-compatible object.)
 *   3. Manifest DTO + schema — `AgentManifest` +
 *      `AgentManifestMetadataSchema`.
 *   4. Use-case verbs — one class per verb + its Request / Response
 *      Zod schemas + types + Error union.
 *   5. Error atoms — every DU type referenced by any exported error
 *      union (domain rule violations, port-level outcomes,
 *      source-layer failures).
 *   6. Drizzle adapter + Markdown source adapter — for DI composition
 *      at host setup time.
 *
 * NOT exported (package-internal):
 *   - `AgentEntity` class (mutable rich entity; consumers go through
 *     use-cases and receive response views).
 *   - Drizzle schema / mapper / row types — adapter detail.
 *
 * Tier role: T0 (foundation). No HTTP, no global state, no top-level
 * orchestration.
 */

// ─── use-cases ─────────────────────────────────────────────────────
export {
  type AttachSkillDeps,
  type AttachSkillError,
  type AttachSkillRequest,
  AttachSkillRequestSchema,
  type AttachSkillResponse,
  AttachSkillResponseSchema,
  AttachSkillUseCase,
  type SkillDoesNotExist,
} from "./application/agent-attach-skill.js";
export {
  type CreateAgentDeps,
  type CreateAgentError,
  type CreateAgentRequest,
  CreateAgentRequestSchema,
  type CreateAgentResponse,
  CreateAgentResponseSchema,
  CreateAgentUseCase,
} from "./application/agent-create.js";
export {
  type DeleteAgentDeps,
  type DeleteAgentError,
  type DeleteAgentRequest,
  DeleteAgentRequestSchema,
  type DeleteAgentResponse,
  DeleteAgentResponseSchema,
  DeleteAgentUseCase,
} from "./application/agent-delete.js";
export {
  type DisableAgentDeps,
  type DisableAgentError,
  type DisableAgentRequest,
  DisableAgentRequestSchema,
  type DisableAgentResponse,
  DisableAgentResponseSchema,
  DisableAgentUseCase,
} from "./application/agent-disable.js";
export {
  type EnableAgentDeps,
  type EnableAgentError,
  type EnableAgentRequest,
  EnableAgentRequestSchema,
  type EnableAgentResponse,
  EnableAgentResponseSchema,
  EnableAgentUseCase,
} from "./application/agent-enable.js";
export {
  type InstallAgentDeps,
  type InstallAgentError,
  type InstallAgentRequest,
  InstallAgentRequestSchema,
  type InstallAgentResponse,
  InstallAgentResponseSchema,
  InstallAgentUseCase,
} from "./application/agent-install.js";
export {
  type ListAgentsDeps,
  type ListAgentsError,
  ListAgentsRequestSchema,
  ListAgentsResponseSchema,
  ListAgentsUseCase,
} from "./application/agent-list.js";
export {
  type RenameAgentDeps,
  type RenameAgentError,
  type RenameAgentRequest,
  RenameAgentRequestSchema,
  type RenameAgentResponse,
  RenameAgentResponseSchema,
  RenameAgentUseCase,
} from "./application/agent-rename.js";
// ─── use-case contract ─────────────────────────────────────────────
export type { UseCase, UseCaseResult } from "./application/use-case.js";
// ─── branded ids ───────────────────────────────────────────────────
export { type AgentId, agentId, type SkillId, skillId } from "./domain/agent-entity.js";
// ─── domain error atoms + aggregate alias (DU types) ───────────────
export type {
  AgentAlreadyDisabled,
  AgentAlreadyEnabled,
  AgentError,
  InvalidAgentName,
  InvalidManifest,
  SkillAlreadyAttached,
  SkillNotAttached,
} from "./domain/agent-errors.js";
// ─── manifest DTO + metadata schema ────────────────────────────────
export {
  type AgentManifest,
  type AgentManifestMetadata,
  AgentManifestMetadataSchema,
} from "./domain/agent-manifest.js";
export type {
  AgentNotFound,
  AgentRepository,
  DatabaseUnavailable,
} from "./domain/agent-repository.js";
export type { SkillRepository } from "./domain/skill-repository.js";
// ─── domain ports ──────────────────────────────────────────────────
export type {
  ManifestInvalid,
  OriginInvalid,
  Source,
  SourceError,
  SourceUnavailable,
} from "./domain/source.js";

// ─── adapters (host wiring) ────────────────────────────────────────
export { DrizzleAgentRepository } from "./infrastructure/drizzle/agent-repository.js";
export { MarkdownAgentSource } from "./infrastructure/markdown/markdown-agent-source.js";
