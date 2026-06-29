/**
 * Use case: reverse-lookup an installed skill by source origin.
 *
 * Origin is matched verbatim against the stored provenance string.
 * `SkillNotFound` is keyed by origin when nothing matches.
 */

import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetSkillByOriginRequestSchema = z.object({
  origin: z.string(),
});
export type GetSkillByOriginRequest = z.infer<typeof GetSkillByOriginRequestSchema>;

export const GetSkillByOriginResponseSchema = z.object({
  id: z.string(),
  origin: z.string(),
  version: z.string(),
});
export type GetSkillByOriginResponse = z.infer<typeof GetSkillByOriginResponseSchema>;

export type GetSkillByOriginError = SkillNotFound | DatabaseUnavailable;

export interface GetSkillByOriginDeps {
  readonly skillRepo: SkillRepository;
}

export class GetSkillByOriginUseCase
  implements UseCase<GetSkillByOriginRequest, GetSkillByOriginResponse, GetSkillByOriginError>
{
  constructor(private readonly deps: GetSkillByOriginDeps) {}

  async execute(
    request: GetSkillByOriginRequest,
  ): UseCaseResult<GetSkillByOriginResponse, GetSkillByOriginError> {
    return this.deps.skillRepo
      .getByOrigin(request.origin)
      .map((skill) => ({ id: skill.id, origin: skill.origin, version: skill.version }));
  }
}
