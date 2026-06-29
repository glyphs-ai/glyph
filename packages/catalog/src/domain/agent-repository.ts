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
 * State-only mutations (disable / enable) omit the arg and leave the
 * file tree untouched.
 */

import type { ResultAsync } from "neverthrow";
import type { AgentEntity } from "./agent-entity.js";
import type { AgentFqn } from "./agent-fqn.js";
import type { McpFqn } from "./mcp-fqn.js";
import type { SkillFqn } from "./skill-fqn.js";

export type AgentNotFound = {
  readonly type: "AgentNotFound";
  readonly fqn: string;
};

export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type CatalogFile = {
  readonly relPath: string;
  readonly content: Buffer;
};

export type CatalogFileEntry = {
  readonly relPath: string;
  readonly size: number;
};

export interface AgentRepository {
  get(id: AgentFqn): ResultAsync<AgentEntity, AgentNotFound | DatabaseUnavailable>;
  findByFqn(id: AgentFqn): ResultAsync<AgentEntity | undefined, DatabaseUnavailable>;
  findByOrigin(origin: string): ResultAsync<AgentEntity | undefined, DatabaseUnavailable>;
  save(
    agent: AgentEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable>;
  delete(id: AgentFqn): ResultAsync<void, DatabaseUnavailable>;
  list(): ResultAsync<AgentEntity[], DatabaseUnavailable>;
  getAnchor(id: AgentFqn): ResultAsync<string, AgentNotFound | DatabaseUnavailable>;
  listFilePaths(id: AgentFqn): ResultAsync<CatalogFileEntry[], DatabaseUnavailable>;
  getFile(id: AgentFqn, relPath: string): ResultAsync<Buffer | null, DatabaseUnavailable>;
  streamFiles(id: AgentFqn): AsyncIterable<CatalogFile>;
  /** True iff some installed agent declares a dependency on `skill`. */
  existsUsingSkill(skill: SkillFqn): ResultAsync<boolean, DatabaseUnavailable>;
  /** True iff some installed agent declares a dependency on `mcp`. */
  existsUsingMcp(mcp: McpFqn): ResultAsync<boolean, DatabaseUnavailable>;
  /** True iff some installed agent declares a dependency on `agent`. */
  existsUsingAgent(agent: AgentFqn): ResultAsync<boolean, DatabaseUnavailable>;
}
