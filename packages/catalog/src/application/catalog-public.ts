/**
 * Application-layer barrel for domain symbols that cross the package boundary.
 *
 * Root exports include branded fqns, `CatalogKind`, declared dependency value
 * objects, and error atoms used by public use-case error unions. Entity,
 * repository, source, manifest, drizzle schema, mapper, and row types remain
 * package-internal.
 */

// ─── Declared-dependency value objects ─────────────────────────────
export type { AgentDependencyRefs } from "../domain/agent-deps.js";
// ─── Domain error atoms (referenced by use-case error unions) ──────
export type { AgentAlreadyDisabled, AgentAlreadyEnabled } from "../domain/agent-entity.js";
// ─── Branded ids ───────────────────────────────────────────────────
export { type AgentFqn, AgentFqnSchema } from "../domain/agent-fqn.js";
export type { AgentNotFound, DatabaseUnavailable } from "../domain/agent-repository.js";
// ─── Kind discriminator ────────────────────────────────────────────
export type { CatalogKind } from "../domain/catalog-kind.js";
export { type McpFqn, McpFqnSchema } from "../domain/mcp-fqn.js";
export type { McpNotFound } from "../domain/mcp-repository.js";
export type { SkillDependencyRefs } from "../domain/skill-deps.js";
export { type SkillFqn, SkillFqnSchema } from "../domain/skill-fqn.js";
export type { SkillNotFound } from "../domain/skill-repository.js";
export type { ManifestInvalid, OriginInvalid, SourceUnavailable } from "../domain/source.js";
