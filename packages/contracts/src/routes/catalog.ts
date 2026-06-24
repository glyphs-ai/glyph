/**
 * Catalog routes (workspace-scoped) plus their request / response wire
 * shapes. Covers the overview counts and the skills / agents / mcps
 * resource surfaces (list / get / resolve / install / sync / delete /
 * file browse). The catalog domain types (`SkillEntry`, `AgentEntry`,
 * `Mcp`, install bodies, sync results) come from `@glyphs-ai/catalog`;
 * this module declares the contracts-local response wrappers.
 */

import type {
  Agent,
  AgentEntry,
  AgentInstallBody,
  CatalogInstallResult,
  CatalogSyncResult,
  Mcp,
  Skill,
  SkillEntry,
  SkillInstallBody,
} from "@glyphs-ai/catalog";
import type { ResolveManifest } from "../plan-to-manifest.js";
import { defineRoute, type RouteRequest, type RouteSpec } from "./_spec.js";
import type { WorkspacePathParams } from "./workspaces.js";

/** Wire shape for a single file entry in the catalog file browser. */
export interface CatalogFileEntry {
  readonly relPath: string;
  readonly size: number;
}

/**
 * POST /api/workspaces/:id/catalog/{kind}/:name/sync body. The
 * `planToken` is minted by the matching `/sync/resolve` (returned
 * inside the `ResolveManifest`) and is single-use + 5-min TTL on
 * the server. See {@link CatalogService.cachePlan} / `takePlan`
 * for the rationale: the apply step replays the exact preview-time
 * plan rather than re-resolving (which would silently apply a
 * fresh, possibly-different closure).
 */
export interface CatalogSyncBody {
  readonly planToken: string;
}

/** GET /api/workspaces/:id/catalog/overview response. */
export interface CatalogOverview {
  readonly counts: {
    readonly skills: number;
    readonly agents: number;
    readonly mcps: number;
    readonly blocked: number;
    readonly orphaned: number;
  };
}

/** GET /api/workspaces/:id/catalog/skills/:name response (entry + content). */
export type SkillWithContent = SkillEntry & { readonly content: string };

/** GET /api/workspaces/:id/catalog/agents/:name response. */
export type AgentWithContent = AgentEntry & { readonly content: string };

/** GET /api/workspaces/:id/catalog/{agents,skills}/:name/anchor response. */
export interface AnchorResponse {
  readonly content: string;
}

/** GET /api/workspaces/:id/catalog/mcps/:name response. */
export type McpWithContent = Mcp & { readonly content: string };

/** Generic `{ ok: true }` response shape for delete / put-content endpoints. */
export interface OkResponse {
  readonly ok: true;
}

/** Catalog-resource path params (skills / agents / mcps). `name` may contain slashes. */
export interface CatalogResourcePathParams {
  readonly id: string;
  readonly name: string;
}

/** Catalog file path params for skill / agent file reads. */
export interface CatalogFilePathParams extends CatalogResourcePathParams {
  readonly path: string;
}

export const catalogRoutes = {
  // ── catalog overview (workspace-scoped) ────────────────────────────
  "catalog.overview.get": defineRoute<{ params: WorkspacePathParams }, CatalogOverview>(
    "GET",
    "/api/workspaces/:id/catalog/overview",
  ),

  // ── catalog skills ─────────────────────────────────────────────────
  "catalog.skills.list": defineRoute<{ params: WorkspacePathParams }, readonly SkillEntry[]>(
    "GET",
    "/api/workspaces/:id/catalog/skills",
  ),
  "catalog.skills.resolve": defineRoute<
    { params: WorkspacePathParams; body: SkillInstallBody },
    ResolveManifest
  >("POST", "/api/workspaces/:id/catalog/skills/resolve"),
  "catalog.skills.get": defineRoute<{ params: CatalogResourcePathParams }, SkillWithContent>(
    "GET",
    "/api/workspaces/:id/catalog/skills/:name",
  ),
  "catalog.skills.anchor.get": defineRoute<{ params: CatalogResourcePathParams }, AnchorResponse>(
    "GET",
    "/api/workspaces/:id/catalog/skills/:name/anchor",
  ),
  "catalog.skills.install": defineRoute<
    { params: WorkspacePathParams; body: SkillInstallBody },
    CatalogInstallResult
  >("POST", "/api/workspaces/:id/catalog/skills"),
  "catalog.skills.delete": defineRoute<{ params: CatalogResourcePathParams }, OkResponse>(
    "DELETE",
    "/api/workspaces/:id/catalog/skills/:name",
  ),
  "catalog.skills.sync.resolve": defineRoute<
    { params: CatalogResourcePathParams },
    ResolveManifest
  >("POST", "/api/workspaces/:id/catalog/skills/:name/sync/resolve"),
  "catalog.skills.sync": defineRoute<
    { params: CatalogResourcePathParams; body: CatalogSyncBody },
    CatalogSyncResult
  >("POST", "/api/workspaces/:id/catalog/skills/:name/sync"),
  "catalog.skills.prereqs.acknowledge": defineRoute<{ params: CatalogResourcePathParams }, Skill>(
    "POST",
    "/api/workspaces/:id/catalog/skills/:name/acknowledge-prereqs",
  ),
  "catalog.skills.files.list": defineRoute<
    { params: CatalogResourcePathParams },
    CatalogFileEntry[]
  >("GET", "/api/workspaces/:id/catalog/skills/:name/files"),
  "catalog.skills.files.get": defineRoute<{ params: CatalogFilePathParams }, ArrayBuffer>(
    "GET",
    "/api/workspaces/:id/catalog/skills/:name/files/:path",
  ),

  // ── catalog agents ─────────────────────────────────────────────────
  "catalog.agents.list": defineRoute<{ params: WorkspacePathParams }, readonly AgentEntry[]>(
    "GET",
    "/api/workspaces/:id/catalog/agents",
  ),
  "catalog.agents.resolve": defineRoute<
    { params: WorkspacePathParams; body: AgentInstallBody },
    ResolveManifest
  >("POST", "/api/workspaces/:id/catalog/agents/resolve"),
  "catalog.agents.get": defineRoute<{ params: CatalogResourcePathParams }, AgentWithContent>(
    "GET",
    "/api/workspaces/:id/catalog/agents/:name",
  ),
  "catalog.agents.anchor.get": defineRoute<{ params: CatalogResourcePathParams }, AnchorResponse>(
    "GET",
    "/api/workspaces/:id/catalog/agents/:name/anchor",
  ),
  "catalog.agents.install": defineRoute<
    { params: WorkspacePathParams; body: AgentInstallBody },
    CatalogInstallResult
  >("POST", "/api/workspaces/:id/catalog/agents"),
  "catalog.agents.delete": defineRoute<{ params: CatalogResourcePathParams }, OkResponse>(
    "DELETE",
    "/api/workspaces/:id/catalog/agents/:name",
  ),
  "catalog.agents.sync.resolve": defineRoute<
    { params: CatalogResourcePathParams },
    ResolveManifest
  >("POST", "/api/workspaces/:id/catalog/agents/:name/sync/resolve"),
  "catalog.agents.sync": defineRoute<
    { params: CatalogResourcePathParams; body: CatalogSyncBody },
    CatalogSyncResult
  >("POST", "/api/workspaces/:id/catalog/agents/:name/sync"),
  "catalog.agents.prereqs.acknowledge": defineRoute<{ params: CatalogResourcePathParams }, Agent>(
    "POST",
    "/api/workspaces/:id/catalog/agents/:name/acknowledge-prereqs",
  ),
  "catalog.agents.disable": defineRoute<{ params: CatalogResourcePathParams }, Agent>(
    "POST",
    "/api/workspaces/:id/catalog/agents/:name/disable",
  ),
  "catalog.agents.enable": defineRoute<{ params: CatalogResourcePathParams }, Agent>(
    "POST",
    "/api/workspaces/:id/catalog/agents/:name/enable",
  ),
  "catalog.agents.files.list": defineRoute<
    { params: CatalogResourcePathParams },
    CatalogFileEntry[]
  >("GET", "/api/workspaces/:id/catalog/agents/:name/files"),
  "catalog.agents.files.get": defineRoute<{ params: CatalogFilePathParams }, ArrayBuffer>(
    "GET",
    "/api/workspaces/:id/catalog/agents/:name/files/:path",
  ),

  // ── catalog mcps (no resolve, no metadata patch) ───────────────────
  "catalog.mcps.list": defineRoute<{ params: WorkspacePathParams }, readonly Mcp[]>(
    "GET",
    "/api/workspaces/:id/catalog/mcps",
  ),
  "catalog.mcps.get": defineRoute<{ params: CatalogResourcePathParams }, McpWithContent>(
    "GET",
    "/api/workspaces/:id/catalog/mcps/:name",
  ),
  "catalog.mcps.install": defineRoute<
    {
      params: WorkspacePathParams;
      body: { readonly origin: string };
    },
    CatalogInstallResult
  >("POST", "/api/workspaces/:id/catalog/mcps"),
  "catalog.mcps.delete": defineRoute<{ params: CatalogResourcePathParams }, OkResponse>(
    "DELETE",
    "/api/workspaces/:id/catalog/mcps/:name",
  ),
  "catalog.mcps.sync.resolve": defineRoute<{ params: CatalogResourcePathParams }, ResolveManifest>(
    "POST",
    "/api/workspaces/:id/catalog/mcps/:name/sync/resolve",
  ),
  "catalog.mcps.sync": defineRoute<
    { params: CatalogResourcePathParams; body: CatalogSyncBody },
    CatalogSyncResult
  >("POST", "/api/workspaces/:id/catalog/mcps/:name/sync"),
} as const satisfies Record<string, RouteSpec<RouteRequest, unknown>>;
