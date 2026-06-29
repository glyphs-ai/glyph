/**
 * Repository port for the Skill aggregate. Domain-owned; the drizzle
 * adapter implements it. `save(skill, files?)` writes the row and dep rows;
 * when `files` is supplied it also writes the file tree. `streamFiles` and
 * `getAnchor` are read paths for serving installed bytes.
 *
 * Error contract: inline unions per signature, atoms exported for
 * use-case unions. `DatabaseUnavailable` is shared with agent/mcp ports.
 */

import type { ResultAsync } from "neverthrow";
import type { CatalogFile, CatalogFileEntry, DatabaseUnavailable } from "./agent-repository.js";
import type { McpFqn } from "./mcp-fqn.js";
import type { SkillEntity } from "./skill-entity.js";
import type { SkillFqn } from "./skill-fqn.js";

export type SkillNotFound = {
  readonly type: "SkillNotFound";
  /** Lookup key that resolved to zero rows — fqn for `get`, origin for `getByOrigin`. */
  readonly fqn: string;
};

export interface SkillRepository {
  get(fqn: SkillFqn): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable>;
  getByOrigin(origin: string): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable>;
  findByFqn(fqn: SkillFqn): ResultAsync<SkillEntity | undefined, DatabaseUnavailable>;
  findByOrigin(origin: string): ResultAsync<SkillEntity | undefined, DatabaseUnavailable>;
  save(
    skill: SkillEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable>;
  delete(fqn: SkillFqn): ResultAsync<void, DatabaseUnavailable>;
  list(): ResultAsync<SkillEntity[], DatabaseUnavailable>;
  getAnchor(fqn: SkillFqn): ResultAsync<string, SkillNotFound | DatabaseUnavailable>;
  listFilePaths(fqn: SkillFqn): ResultAsync<CatalogFileEntry[], DatabaseUnavailable>;
  getFile(fqn: SkillFqn, relPath: string): ResultAsync<Buffer | null, DatabaseUnavailable>;
  streamFiles(fqn: SkillFqn): AsyncIterable<CatalogFile>;
  /** True iff some installed skill declares a dependency on `skill`. */
  existsUsingSkill(skill: SkillFqn): ResultAsync<boolean, DatabaseUnavailable>;
  /** True iff some installed skill declares a dependency on `mcp`. */
  existsUsingMcp(mcp: McpFqn): ResultAsync<boolean, DatabaseUnavailable>;
}
