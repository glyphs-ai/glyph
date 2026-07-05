/**
 * Use case: uninstall a skill. Refuses to delete a skill that another
 * installed agent or skill still depends on — deleting it would leave a
 * dangling dep edge. The guard reads the agent + skill skill-dep edge tables
 * through the read-side queries seam. `SkillNotFound` when the fqn doesn't
 * resolve; `HasDependents` when something still references it.
 */

import { err, ok, safeTry } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import type { UseCase, UseCaseResult } from "../use-case.js";
import { collectReferencedSkillFqns } from "./skill-reads.js";

export const UninstallSkillRequestSchema = z.object({
  id: SkillFqnSchema,
});
export type UninstallSkillRequest = z.infer<typeof UninstallSkillRequestSchema>;

export const UninstallSkillResponseSchema = z.object({
  id: z.string(),
});
export type UninstallSkillResponse = z.infer<typeof UninstallSkillResponseSchema>;

export type HasDependents = {
  readonly type: "HasDependents";
  readonly fqn: string;
};

export type UninstallSkillError = SkillNotFound | HasDependents | DatabaseUnavailable;

export interface UninstallSkillDeps {
  readonly skillRepo: SkillRepository;
  readonly queries: CatalogQueries;
}

export class UninstallSkillUseCase
  implements UseCase<UninstallSkillRequest, UninstallSkillResponse, UninstallSkillError>
{
  constructor(private readonly deps: UninstallSkillDeps) {}

  execute(
    request: UninstallSkillRequest,
  ): UseCaseResult<UninstallSkillResponse, UninstallSkillError> {
    const fqn = request.id;
    const deps = this.deps;
    return safeTry<UninstallSkillResponse, UninstallSkillError>(async function* () {
      yield* deps.skillRepo.get(fqn);
      const referenced = yield* deps.queries.query((db) => collectReferencedSkillFqns(db).has(fqn));
      if (referenced) {
        return err<UninstallSkillResponse, UninstallSkillError>({ type: "HasDependents", fqn });
      }
      yield* deps.skillRepo.delete(fqn);
      return ok<UninstallSkillResponse, UninstallSkillError>({ id: fqn });
    });
  }
}
