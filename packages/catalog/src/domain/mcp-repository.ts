/**
 * Repository port for the MCP aggregate. Domain-owned interface; the
 * drizzle adapter under `infrastructure/drizzle/` implements it.
 *
 * Error contract: inline unions per signature (no per-op alias). Atoms
 * are exported so use-case unions can reference them. `McpNotFound` is a
 * normal business outcome (id resolves to 0 rows), distinct from
 * `DatabaseUnavailable` (the IO layer faulted).
 *
 * Only get/save/delete/list — no business verbs. Origin-conflict checks
 * are an application concern: the install use-case reads via `get` and
 * compares origins. `save` is a full-row write (insert-or-replace).
 */

import type { ResultAsync } from "neverthrow";
import type { McpEntity } from "./mcp-entity.js";
import type { McpFqn } from "./mcp-fqn.js";

export type McpNotFound = {
  readonly type: "McpNotFound";
  /** The lookup key that resolved to zero rows — fqn for `get`, origin for `getByOrigin`. */
  readonly fqn: string;
};

export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export interface McpRepository {
  get(fqn: McpFqn): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable>;
  getByOrigin(origin: string): ResultAsync<McpEntity, McpNotFound | DatabaseUnavailable>;
  findByFqn(fqn: McpFqn): ResultAsync<McpEntity | undefined, DatabaseUnavailable>;
  findByOrigin(origin: string): ResultAsync<McpEntity | undefined, DatabaseUnavailable>;
  save(mcp: McpEntity): ResultAsync<void, DatabaseUnavailable>;
  delete(fqn: McpFqn): ResultAsync<void, DatabaseUnavailable>;
  list(): ResultAsync<McpEntity[], DatabaseUnavailable>;
}
