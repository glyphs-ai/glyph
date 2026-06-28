/**
 * Published declaration surface of `@glyphs-ai/catalog` — error classes,
 * wire DTOs, install-body validators, and the FQN grammar helpers.
 *
 * Aggregates the public vocabulary in one import path: domain errors
 * (grammar / codec / graph invariants) come from `../domain`, application
 * errors (use-case failures) from this layer, and fetcher (infra) errors
 * from `../fetcher`.
 */

// ─── errors: domain (grammar / codec / graph) ───────
export {
  AgentFrontmatterError,
  AgentNameInvalidError,
  AgentUnresolvedDepError,
} from "../domain/agent.errors.js";
export { McpInvalidJsonError, McpNameInvalidError } from "../domain/mcp.errors.js";
// ─── FQN grammar (domain) ───────────────────────────
export { validateMcpName } from "../domain/mcp.schemas.js";
export {
  CyclicDependencyError,
  SkillFrontmatterError,
  SkillNameInvalidError,
  SkillUnresolvedDepError,
} from "../domain/skill.errors.js";
export {
  DEFAULT_SCOPE,
  makeFqn,
  splitFqn,
  validateFqn,
  validateScope,
  validateShortName,
} from "../domain/skill.schemas.js";
// ─── errors: fetcher (infra) ────────────────────────
export { FetchError, OriginParseError } from "../fetcher/errors.js";
// ─── errors: application (use-case) ─────────────────
export {
  AgentNotFoundError,
  AgentOriginConflictError,
  AgentPlanStaleError,
} from "./agent.errors.js";
export { HasDependentsError } from "./catalog.errors.js";
// ─── install-body validators (application) ──────────
export {
  validateAgentInstallInput,
  validateMcpInstallInput,
  validateSkillInstallInput,
} from "./catalog.schemas.js";
// ─── wire DTOs ──────────────────────────────────────
export type {
  Agent,
  AgentEntry,
  AgentResolveResult,
  BlockedDep,
  BlockedReason,
  CatalogKind,
  DependencyKind,
  DependencyRef,
  EntryStatus,
  InstallAgentRequest,
  InstallMcpRequest,
  InstallSkillRequest,
  Mcp,
  MissingDep,
  ResolvedMcp,
  ResolvedSkill,
  Skill,
  SkillEntry,
  SkillResolveResult,
} from "./catalog.types.js";
export { McpNotFoundError, McpOriginConflictError } from "./mcp.errors.js";
export { PlanStaleError, SkillNotFoundError, SkillOriginConflictError } from "./skill.errors.js";
