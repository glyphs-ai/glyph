/**
 * Public surface of @glyphs-ai/catalog.
 *
 * Schema-first, Result-based, discriminated-union errors, no throws
 * across the package boundary. Every use-case implements
 * `UseCase<Request, Response, Error>` and returns
 * `UseCaseResult = Promise<Result<Response, Error>>`.
 *
 * Exports:
 *   - Per use-case: its `Request` / `Response` Zod schemas + inferred
 *     types and `Error` union — the wire contract.
 *   - Curated domain surface via `./application/catalog-public.js`: branded fqns
 *     + schemas, `CatalogKind`, the dependency-ref value objects, and
 *     the error atoms the use-case error unions are built from.
 *   - Resolution graph types (`ResolvedGraph`, `ResolvedNode`,
 *     `CatalogConflict`) and the plan shape (`CatalogPlan`, `PlanNode`).
 *   - `composeCatalog` → `CatalogModule`: the DI container a host builds
 *     once and dispatches through.
 *
 * NOT exported (package-internal): use-case classes + their `Deps`,
 * entity classes, repository / source ports, manifest DTOs, drizzle
 * schema / mapper / row types, and the drizzle + markdown adapters —
 * hosts construct and call everything through `composeCatalog`.
 *
 * Tier role: T0 (foundation). No HTTP, no global state.
 */

export {
  type AcknowledgeAgentPrereqsError,
  type AcknowledgeAgentPrereqsRequest,
  AcknowledgeAgentPrereqsRequestSchema,
  type AcknowledgeAgentPrereqsResponse,
  AcknowledgeAgentPrereqsResponseSchema,
} from "./application/agent/acknowledge-agent-prereqs.js";
export {
  type DisableAgentError,
  type DisableAgentRequest,
  DisableAgentRequestSchema,
  type DisableAgentResponse,
  DisableAgentResponseSchema,
} from "./application/agent/disable-agent.js";
export {
  type EnableAgentError,
  type EnableAgentRequest,
  EnableAgentRequestSchema,
  type EnableAgentResponse,
  EnableAgentResponseSchema,
} from "./application/agent/enable-agent.js";
export {
  type GetAgentError,
  type GetAgentRequest,
  GetAgentRequestSchema,
  type GetAgentResponse,
  GetAgentResponseSchema,
} from "./application/agent/get-agent.js";
export {
  type GetAgentContentError,
  type GetAgentContentRequest,
  GetAgentContentRequestSchema,
  type GetAgentContentResponse,
  GetAgentContentResponseSchema,
} from "./application/agent/get-agent-content.js";
export {
  type GetAgentEntryError,
  type GetAgentEntryRequest,
  GetAgentEntryRequestSchema,
  type GetAgentEntryResponse,
  GetAgentEntryResponseSchema,
} from "./application/agent/get-agent-entry.js";
export {
  type GetAgentFileError,
  type GetAgentFileRequest,
  GetAgentFileRequestSchema,
  type GetAgentFileResponse,
} from "./application/agent/get-agent-file.js";
export {
  type InstallAgentError,
  type InstallAgentRequest,
  InstallAgentRequestSchema,
  type InstallAgentResponse,
  InstallAgentResponseSchema,
} from "./application/agent/install-agent.js";
export {
  type ListAgentEntriesError,
  type ListAgentEntriesRequest,
  ListAgentEntriesRequestSchema,
  type ListAgentEntriesResponse,
  ListAgentEntriesResponseSchema,
} from "./application/agent/list-agent-entries.js";
export {
  type ListAgentFilesError,
  type ListAgentFilesRequest,
  ListAgentFilesRequestSchema,
  type ListAgentFilesResponse,
  ListAgentFilesResponseSchema,
} from "./application/agent/list-agent-files.js";
export {
  type ListAgentsError,
  ListAgentsRequestSchema,
  ListAgentsResponseSchema,
} from "./application/agent/list-agents.js";
export {
  type ResolveAgentError,
  type ResolveAgentRequest,
  ResolveAgentRequestSchema,
  type ResolveAgentResponse,
  ResolveAgentResponseSchema,
} from "./application/agent/resolve-agent.js";
// ─── use-cases ─────────────────────────────────────────────────────
export {
  type UninstallAgentError,
  type UninstallAgentRequest,
  UninstallAgentRequestSchema,
  type UninstallAgentResponse,
  UninstallAgentResponseSchema,
} from "./application/agent/uninstall-agent.js";
// ─── curated domain surface (fqns, kind, dep-refs, error atoms) ────
// Funnelled through the application barrel so this file never mentions
// `./domain/*` directly — domain stays private to the package. Entity
// classes, repository / source ports, manifest DTOs, and the drizzle +
// markdown adapters are intentionally NOT exported: hosts construct
// everything through `composeCatalog`.
export * from "./application/catalog-public.js";
export {
  type GetMcpError,
  type GetMcpRequest,
  GetMcpRequestSchema,
  type GetMcpResponse,
  GetMcpResponseSchema,
} from "./application/mcp/get-mcp.js";
export {
  type GetMcpByOriginError,
  type GetMcpByOriginRequest,
  GetMcpByOriginRequestSchema,
  type GetMcpByOriginResponse,
  GetMcpByOriginResponseSchema,
} from "./application/mcp/get-mcp-by-origin.js";
export {
  type GetMcpContentError,
  type GetMcpContentRequest,
  GetMcpContentRequestSchema,
  type GetMcpContentResponse,
  GetMcpContentResponseSchema,
} from "./application/mcp/get-mcp-content.js";
// ─── mcp domain error atoms (defined alongside their use-case/entity) ──
export type { McpOriginConflict } from "./application/mcp/install-mcp.js";
export {
  type InstallMcpError,
  type InstallMcpRequest,
  InstallMcpRequestSchema,
  type InstallMcpResponse,
  InstallMcpResponseSchema,
} from "./application/mcp/install-mcp.js";
export {
  type ListMcpsError,
  type ListMcpsRequest,
  ListMcpsRequestSchema,
  type ListMcpsResponse,
  ListMcpsResponseSchema,
} from "./application/mcp/list-mcps.js";
export {
  type UninstallMcpError,
  type UninstallMcpRequest,
  UninstallMcpRequestSchema,
  type UninstallMcpResponse,
  UninstallMcpResponseSchema,
} from "./application/mcp/uninstall-mcp.js";
// ─── resolve pipeline (plan + apply) ───────────────────────────────
export {
  type ApplyPlanError,
  type ApplyPlanRequest,
  ApplyPlanRequestSchema,
  type ApplyPlanResponse,
  ApplyPlanResponseSchema,
} from "./application/resolution/apply-plan.js";
export type {
  CatalogConflict,
  ResolvedGraph,
  ResolvedNode,
} from "./application/resolution/dependency-graph.js";
export { ResolvedGraphSchema } from "./application/resolution/dependency-graph.js";
export {
  type GetTreeError,
  type GetTreeRequest,
  GetTreeRequestSchema,
  type GetTreeResponse,
} from "./application/resolution/get-tree.js";
export {
  type GetUpstreamTreeError,
  type GetUpstreamTreeRequest,
  GetUpstreamTreeRequestSchema,
  type GetUpstreamTreeResponse,
} from "./application/resolution/get-upstream-tree.js";
export {
  type CatalogPlan,
  type IdentityChange,
  type Orphan,
  type PlanNode,
  type ResolvePlanError,
  type ResolvePlanRequest,
  ResolvePlanRequestSchema,
  type ResolvePlanResponse,
  ResolvePlanResponseSchema,
} from "./application/resolution/resolve-plan.js";
export {
  type AcknowledgePrereqsError,
  type AcknowledgePrereqsRequest,
  AcknowledgePrereqsRequestSchema,
  type AcknowledgePrereqsResponse,
} from "./application/skill/acknowledge-skill-prereqs.js";
export {
  type GetSkillError,
  type GetSkillRequest,
  GetSkillRequestSchema,
  type GetSkillResponse,
  GetSkillResponseSchema,
} from "./application/skill/get-skill.js";
export {
  type GetSkillByOriginError,
  type GetSkillByOriginRequest,
  GetSkillByOriginRequestSchema,
  type GetSkillByOriginResponse,
  GetSkillByOriginResponseSchema,
} from "./application/skill/get-skill-by-origin.js";
export {
  type GetSkillContentError,
  type GetSkillContentRequest,
  GetSkillContentRequestSchema,
  type GetSkillContentResponse,
  GetSkillContentResponseSchema,
} from "./application/skill/get-skill-content.js";
export {
  type GetSkillEntryError,
  type GetSkillEntryRequest,
  GetSkillEntryRequestSchema,
  type GetSkillEntryResponse,
  GetSkillEntryResponseSchema,
} from "./application/skill/get-skill-entry.js";
export {
  type GetSkillFileError,
  type GetSkillFileRequest,
  GetSkillFileRequestSchema,
  type GetSkillFileResponse,
} from "./application/skill/get-skill-file.js";
// ─── skill domain error atom (defined alongside its use-case) ──────────
export type { SkillOriginConflict } from "./application/skill/install-skill.js";
export {
  type InstallSkillError,
  type InstallSkillRequest,
  InstallSkillRequestSchema,
  type InstallSkillResponse,
  InstallSkillResponseSchema,
} from "./application/skill/install-skill.js";
export {
  type ListSkillEntriesError,
  type ListSkillEntriesRequest,
  ListSkillEntriesRequestSchema,
  type ListSkillEntriesResponse,
  ListSkillEntriesResponseSchema,
} from "./application/skill/list-skill-entries.js";
export {
  type ListSkillFilesError,
  type ListSkillFilesRequest,
  ListSkillFilesRequestSchema,
  type ListSkillFilesResponse,
  ListSkillFilesResponseSchema,
} from "./application/skill/list-skill-files.js";
export {
  type ListSkillsError,
  type ListSkillsRequest,
  ListSkillsRequestSchema,
  type ListSkillsResponse,
  ListSkillsResponseSchema,
} from "./application/skill/list-skills.js";
export {
  type UninstallSkillError,
  type UninstallSkillRequest,
  UninstallSkillRequestSchema,
  type UninstallSkillResponse,
  UninstallSkillResponseSchema,
} from "./application/skill/uninstall-skill.js";
// ─── use-case contract ─────────────────────────────────────────────
export type { UseCase, UseCaseResult } from "./application/use-case.js";
export {
  type CatalogModule,
  type CatalogModuleOptions,
  composeCatalog,
} from "./catalog-module.js";
// ─── infrastructure seams (shared-db support) ──────────────────────
export type { Db } from "./infrastructure/drizzle/catalog-db.js";
export * as schema from "./infrastructure/drizzle/catalog-db.js";
export { applyCatalogMigrations } from "./infrastructure/drizzle/catalog-migrations.js";
export { type CatalogScope, createCatalogScope } from "./infrastructure/drizzle/catalog-scope.js";
