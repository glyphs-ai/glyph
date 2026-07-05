/**
 * Use case: read a skill's anchor (SKILL.md) bytes. The runtime pulls
 * this to materialise the skill's prompt. Project the anchor content;
 * `SkillNotFound` when the fqn (or its anchor) doesn't resolve.
 */

import { and, eq } from "drizzle-orm";
import { errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillNotFound } from "../../domain/skill-repository.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { skillFiles } from "../../infrastructure/drizzle/skill-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

const ANCHOR = "SKILL.md";

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
  readonly queries: CatalogQueries;
}

export class GetSkillContentUseCase
  implements UseCase<GetSkillContentRequest, GetSkillContentResponse, GetSkillContentError>
{
  constructor(private readonly deps: GetSkillContentDeps) {}

  execute(
    request: GetSkillContentRequest,
  ): UseCaseResult<GetSkillContentResponse, GetSkillContentError> {
    const { id } = request;
    return this.deps.queries
      .query((db) => {
        const row = db
          .select({ content: skillFiles.content })
          .from(skillFiles)
          .where(and(eq(skillFiles.skillFqn, id), eq(skillFiles.relPath, ANCHOR)))
          .get();
        return row?.content.toString("utf8");
      })
      .andThen(
        (content): UseCaseResult<GetSkillContentResponse, GetSkillContentError> =>
          content === undefined
            ? errAsync({ type: "SkillNotFound", fqn: id })
            : okAsync({ id, content }),
      );
  }
}
