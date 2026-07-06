/**
 * Problem table for catalog routes.
 *
 * Catalog use-cases return discriminated-union errors; the route
 * infrastructure tags those DU `type` values as `.code` on a
 * `CatalogRouteError` carrier `{ tag, code, message }`. This table maps
 * those catalog-local codes without importing catalog error classes.
 * Same-named errors from other domains stay isolated because only catalog
 * routes pass this table to `respondError`.
 *
 * `detail` echoes the carrier's already-safe `message` for the 4xx/502
 * rows; `DatabaseUnavailable` collapses to the opaque `"internal error"`
 * so an infra `cause` never leaks.
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ProblemTable, RespondProblemOpts } from "../_http-errors.js";

interface CatalogRouteError {
  readonly tag: "CatalogRouteError";
  readonly code: string;
  readonly message: string;
}

interface CatalogDef {
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly detail: (err: CatalogRouteError, opts: RespondProblemOpts) => string;
}

const echo = (err: CatalogRouteError): string => err.message;

const CATALOG_TABLE: Record<string, CatalogDef> = {
  OriginInvalid: { status: 400, title: "Origin invalid", detail: echo },
  ManifestInvalid: { status: 400, title: "Manifest invalid", detail: echo },

  SkillNotFound: { status: 404, title: "Skill not found", detail: echo },
  AgentNotFound: { status: 404, title: "Agent not found", detail: echo },
  McpNotFound: { status: 404, title: "MCP not found", detail: echo },

  SkillOriginConflict: { status: 409, title: "Skill origin conflict", detail: echo },
  AgentOriginConflict: { status: 409, title: "Agent origin conflict", detail: echo },
  McpOriginConflict: { status: 409, title: "MCP origin conflict", detail: echo },
  HasDependents: { status: 409, title: "Catalog entry has dependents", detail: echo },

  SourceUnavailable: { status: 502, title: "Catalog source unavailable", detail: echo },
  DatabaseUnavailable: { status: 503, title: "Internal error", detail: () => "internal error" },
};

/**
 * Catalog Problem table. Keyed by the `CatalogRouteError.code` the route
 * infrastructure stamps on each carrier; consumed by `respondError` with
 * a default status of 500 for any unmapped code.
 */
export const catalogErrorPolicy: ProblemTable = CATALOG_TABLE as unknown as ProblemTable;
