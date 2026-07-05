/**
 * Per-domain error policy for catalog routes.
 *
 * Catalog use-cases return discriminated-union errors. The route
 * infrastructure tags those DU `type` values as `.code`, and this policy
 * maps those catalog-local strings without importing catalog error
 * classes. Same-named errors from other domains remain isolated because
 * only catalog routes use this policy.
 */

import type { ErrorPolicy } from "../_http-errors.js";

function catalogErrorBody(err: unknown): Record<string, unknown> {
  if (isCatalogRouteError(err)) {
    if (err.code === "DatabaseUnavailable") {
      return { error: "internal error", code: err.code };
    }
    return { error: err.message, code: err.code };
  }
  return { error: "internal error" };
}

export const catalogErrorPolicy: ErrorPolicy = {
  name: "catalog",
  defaultStatus: 500,
  statuses: [],
  codeStatuses: [
    ["OriginInvalid", 400, catalogErrorBody],
    ["ManifestInvalid", 400, catalogErrorBody],

    ["SkillNotFound", 404, catalogErrorBody],
    ["AgentNotFound", 404, catalogErrorBody],
    ["McpNotFound", 404, catalogErrorBody],

    ["SkillOriginConflict", 409, catalogErrorBody],
    ["AgentOriginConflict", 409, catalogErrorBody],
    ["McpOriginConflict", 409, catalogErrorBody],
    ["HasDependents", 409, catalogErrorBody],

    ["SourceUnavailable", 502, catalogErrorBody],
    ["DatabaseUnavailable", 500, catalogErrorBody],
  ],
};

function isCatalogRouteError(err: unknown): err is {
  readonly tag: "CatalogRouteError";
  readonly code: string;
  readonly message: string;
} {
  if (typeof err !== "object" || err === null) return false;
  if (!("tag" in err) || err.tag !== "CatalogRouteError") return false;
  if (!("code" in err) || typeof err.code !== "string") return false;
  return "message" in err && typeof err.message === "string";
}
