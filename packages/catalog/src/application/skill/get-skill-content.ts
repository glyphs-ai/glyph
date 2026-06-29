/**
 * Use case: read a skill's anchor (SKILL.md) bytes. The runtime pulls
 * this to materialise the skill's prompt. Project the anchor content;
 * `SkillNotFound` when the fqn (or its anchor) doesn't resolve.
 */

import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound, SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetSkillContentRequestSchema = z.object({
  id: SkillFqnSchema,
});
export type GetSkillContentRequest = z.infer<typeof GetSkillContentRequestSchema>;

export const GetSkillContentResponseSchema = z.object({
  id: z.string(),
  content: z.string(),
});
export type GetSkillContentResponse = z.infer<typeof GetSkillContentResponseSchema>;

export type GetSkillContentError = SkillNotFound | DatabaseUnavailable;

export interface GetSkillContentDeps {
  readonly skillRepo: SkillRepository;
}

export class GetSkillContentUseCase
  implements UseCase<GetSkillContentRequest, GetSkillContentResponse, GetSkillContentError>
{
  constructor(private readonly deps: GetSkillContentDeps) {}

  async execute(
    request: GetSkillContentRequest,
  ): UseCaseResult<GetSkillContentResponse, GetSkillContentError> {
    return this.deps.skillRepo
      .getAnchor(request.id)
      .map((content) => ({ id: request.id, content }));
  }
}
