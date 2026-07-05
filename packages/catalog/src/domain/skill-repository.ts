/**
 * Write-side repository port for the Skill aggregate. Domain-owned; the drizzle
 * adapter implements it. Only the CQRS write triad `get` / `save` / `delete`,
 * used solely by write use-cases; read projections go through the read-side
 * `CatalogQueries` seam.
 *
 * `save(skill, files?)` writes the row and dep rows; when `files` is supplied it
 * also rewrites the file tree. Error contract: inline unions per signature,
 * atoms exported for use-case unions. `DatabaseUnavailable` is shared with the
 * agent/mcp ports (defined in `agent-repository.ts`).
 */

import type { ResultAsync } from "neverthrow";
import type { DatabaseUnavailable } from "./agent-repository.js";
import type { SkillEntity } from "./skill-entity.js";
import type { SkillFqn } from "./skill-fqn.js";

export type SkillNotFound = {
  readonly type: "SkillNotFound";
  /** Lookup key that resolved to zero rows. */
  readonly fqn: string;
};

export interface SkillRepository {
  /** Load the aggregate for mutation. `SkillNotFound` when the fqn is absent. */
  get(fqn: SkillFqn): ResultAsync<SkillEntity, SkillNotFound | DatabaseUnavailable>;
  save(
    skill: SkillEntity,
    files?: ReadonlyMap<string, Buffer>,
  ): ResultAsync<void, DatabaseUnavailable>;
  delete(fqn: SkillFqn): ResultAsync<void, DatabaseUnavailable>;
}
