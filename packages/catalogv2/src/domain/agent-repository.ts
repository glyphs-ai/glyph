/**
 * Repository port for the Agent aggregate. Domain-owned interface; the
 * drizzle adapter under `infrastructure/drizzle/` implements it.
 *
 * Error contract: inline unions in each signature (no per-op alias).
 * Atoms (`AgentNotFound`, `DatabaseUnavailable`) are exported so
 * use-case error unions can reference them.
 *
 * `AgentNotFound` is NOT a `DatabaseUnavailable`:
 *   - `AgentNotFound` = "the id doesn't resolve to a row" — a normal
 *     business outcome (`SELECT … = 0 rows` is not an exception).
 *   - `DatabaseUnavailable` = "the IO layer FAULTED" — driver throw,
 *     sqlite constraint, disk error. Truly exceptional.
 *
 * `save(agent, files)`: the optional `files` Map carries the agent's
 * file tree (anchor + sub-files) when persisting an INSTALL — adapter
 * rewrites the `agent_files` table atomically with the entity row.
 * State-only mutations (disable / enable / rename / attach-skill) omit
 * the arg and leave the file tree untouched.
 */

import type { ResultAsync } from "neverthrow";
import type { AgentEntity, AgentId } from "./agent-entity.js";

export type AgentNotFound = {
  readonly type: "AgentNotFound";
  readonly agentId: string;
};

export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export interface AgentRepository {
  get(id: AgentId): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable>;
  save(
    agent: AgentEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable>;
  delete(id: AgentId): ResultAsync<void, DatabaseUnavailable>;
  list(): ResultAsync<AgentEntity[], DatabaseUnavailable>;
}
