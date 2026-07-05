/**
 * Write-side repository port for the MCP aggregate. Domain-owned interface; the
 * drizzle adapter implements it. Only the CQRS write triad `get` / `save` /
 * `delete`, used solely by write use-cases; read projections go through the
 * read-side `CatalogQueries` seam.
 *
 * Error contract: inline unions per signature (no per-op alias). Atoms are
 * exported so use-case unions can reference them. `McpNotFound` is a normal
 * business outcome (id resolves to 0 rows), distinct from `DatabaseUnavailable`
 * (the IO layer faulted). `save` is a full-row insert-or-replace.
 */

import type { ResultAsync } from "neverthrow";
import type { McpEntity } from "./mcp-entity.js";
import type { McpFqn } from "./mcp-fqn.js";

export type McpNotFound = {
  readonly type: "McpNotFound";
  /** The lookup key that resolved to zero rows. */
  readonly fqn: string;
};

export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export interface McpRepository {
  /** Load the aggregate for mutation. `McpNotFound` when the fqn is absent. */
  get(fqn: McpFqn): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable>;
  save(mcp: McpEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(fqn: McpFqn): ResultAsync<void, DatabaseUnavailable>;
}
