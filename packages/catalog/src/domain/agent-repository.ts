/**
 * Write-side repository port for the Agent aggregate. Domain-owned interface;
 * the drizzle adapter under `infrastructure/drizzle/` implements it. Reads for
 * projections live on the read-side `CatalogQueries` seam — this port exposes
 * only the CQRS write triad `get` / `save` / `delete` and is used solely by
 * write use-cases.
 *
 * Error contract: inline unions per signature (no per-op alias). Atoms
 * (`AgentNotFound`, `DatabaseUnavailable`) are exported so use-case error
 * unions can reference them; `DatabaseUnavailable` is the package-wide IO-fault
 * atom shared by the skill/mcp ports and the queries seam.
 *
 * `AgentNotFound` is NOT a `DatabaseUnavailable`:
 *   - `AgentNotFound` = "the id doesn't resolve to a row" — a normal business
 *     outcome (`SELECT … = 0 rows` is not an exception).
 *   - `DatabaseUnavailable` = "the IO layer FAULTED" — driver throw, sqlite
 *     constraint, disk error. Truly exceptional.
 *
 * `save(agent, files)`: the optional `files` map carries the agent's file tree
 * (anchor + sub-files) when persisting an INSTALL — the adapter rewrites the
 * `agent_files` table atomically with the entity row. State-only mutations
 * (disable / enable / ack) omit the arg and leave the file tree untouched.
 */

import type { ResultAsync } from "neverthrow";
import type { AgentEntity } from "./agent-entity.js";
import type { AgentFqn } from "./agent-fqn.js";

export type AgentNotFound = {
  readonly type: "AgentNotFound";
  readonly fqn: string;
};

export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export interface AgentRepository {
  /** Load the aggregate for mutation. `AgentNotFound` when the id is absent. */
  get(id: AgentFqn): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable>;
  save(
    agent: AgentEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable>;
  delete(id: AgentFqn): ResultAsync<void, DatabaseUnavailable>;
}
