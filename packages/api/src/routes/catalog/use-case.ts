import type { Result } from "neverthrow";

type CatalogRouteKind = "skill" | "agent" | "mcp";

type CatalogErrorLike =
  | { readonly type: "SkillNotFound"; readonly fqn: string }
  | { readonly type: "AgentNotFound"; readonly fqn: string }
  | { readonly type: "McpNotFound"; readonly fqn: string }
  | {
      readonly type: "SkillOriginConflict";
      readonly fqn: string;
      readonly existingOrigin: string;
      readonly attemptedOrigin: string;
    }
  | {
      readonly type: "AgentOriginConflict";
      readonly fqn: string;
      readonly existingOrigin: string;
      readonly attemptedOrigin: string;
    }
  | {
      readonly type: "McpOriginConflict";
      readonly fqn: string;
      readonly existingOrigin: string;
      readonly attemptedOrigin: string;
    }
  | { readonly type: "OriginInvalid"; readonly origin: string; readonly reason: string }
  | { readonly type: "SourceUnavailable"; readonly origin: string; readonly cause: unknown }
  | { readonly type: "ManifestInvalid"; readonly origin: string; readonly reason: string }
  | { readonly type: "HasDependents"; readonly fqn: string }
  | { readonly type: "DatabaseUnavailable"; readonly cause: unknown };

export type CatalogRouteErrorCode = CatalogErrorLike["type"];

export interface CatalogRouteError {
  readonly tag: "CatalogRouteError";
  readonly code: CatalogRouteErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export async function unwrapCatalog<T, E extends CatalogErrorLike>(
  result: Promise<Result<T, E>>,
  kind: CatalogRouteKind,
): Promise<T> {
  const settled = await result;
  if (settled.isOk()) return settled.value;
  throw toCatalogRouteError(settled.error, kind);
}

function toCatalogRouteError(error: CatalogErrorLike, kind: CatalogRouteKind): CatalogRouteError {
  switch (error.type) {
    case "SkillNotFound":
      return catalogRouteError(error.type, `skill not found: ${error.fqn}`);
    case "AgentNotFound":
      return catalogRouteError(error.type, `agent not found: ${error.fqn}`);
    case "McpNotFound":
      return catalogRouteError(error.type, `mcp not found: ${error.fqn}`);
    case "SkillOriginConflict":
      return catalogRouteError(
        error.type,
        `skill ${error.fqn} is already installed from ${error.existingOrigin}, not ${error.attemptedOrigin}`,
      );
    case "AgentOriginConflict":
      return catalogRouteError(
        error.type,
        `agent ${error.fqn} is already installed from ${error.existingOrigin}, not ${error.attemptedOrigin}`,
      );
    case "McpOriginConflict":
      return catalogRouteError(
        error.type,
        `mcp ${error.fqn} is already installed from ${error.existingOrigin}, not ${error.attemptedOrigin}`,
      );
    case "OriginInvalid":
      return catalogRouteError(error.type, `invalid origin ${error.origin}: ${error.reason}`);
    case "SourceUnavailable":
      return catalogRouteError(
        error.type,
        `failed to fetch ${error.origin}: ${causeMessage(error.cause)}`,
        error.cause,
      );
    case "ManifestInvalid":
      return catalogRouteError(
        error.type,
        `invalid ${kind} manifest at ${error.origin}: ${error.reason}`,
      );
    case "HasDependents":
      return catalogRouteError(
        error.type,
        `cannot delete ${error.fqn} — it is still referenced by another installed entry`,
      );
    case "DatabaseUnavailable":
      return catalogRouteError(error.type, "catalog database unavailable", error.cause);
  }
}

function catalogRouteError(
  code: CatalogRouteErrorCode,
  message: string,
  cause?: unknown,
): CatalogRouteError {
  return cause === undefined
    ? { tag: "CatalogRouteError", code, message }
    : { tag: "CatalogRouteError", code, message, cause };
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
