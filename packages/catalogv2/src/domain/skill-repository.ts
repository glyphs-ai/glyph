/**
 * Repository port for the Skill aggregate. The Skill entity itself is
 * out of scope for this skeleton — the port here only carries the
 * operation the Agent use-cases need (existence check at attach time).
 *
 * Inline error union (no per-op alias): `DatabaseUnavailable` reused from
 * `AgentRepository`'s port file. Two ports can share the same atom
 * error type — that's exactly the union behaviour we want.
 *
 * In the full package this file lives alongside its own Skill
 * aggregate (`domain/skill.ts`, ...) and the port grows to cover the
 * skill use-cases. Kept trivial here to keep the skeleton focused on
 * Agent's anatomy.
 */

import type { ResultAsync } from "neverthrow";
import type { SkillId } from "./agent-entity.js";
import type { DatabaseUnavailable } from "./agent-repository.js";

export interface SkillRepository {
  exists(id: SkillId): ResultAsync<boolean, DatabaseUnavailable>;
}
