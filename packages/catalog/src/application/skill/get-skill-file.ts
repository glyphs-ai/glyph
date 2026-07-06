import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { skillFiles } from "../../infrastructure/drizzle/skill-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetSkillFileRequestSchema = z.object({ id: SkillFqnSchema, relPath: z.string() });
export type GetSkillFileRequest = z.infer<typeof GetSkillFileRequestSchema>;
export type GetSkillFileResponse = Buffer | null;
export type GetSkillFileError = DatabaseUnavailable;

export interface GetSkillFileDeps {
  readonly queries: CatalogQueries;
}

export class GetSkillFileUseCase
  implements UseCase<GetSkillFileRequest, GetSkillFileResponse, GetSkillFileError>
{
  constructor(private readonly deps: GetSkillFileDeps) {}

  execute(request: GetSkillFileRequest): UseCaseResult<GetSkillFileResponse, GetSkillFileError> {
    const { id, relPath } = request;
    return this.deps.queries.query((db) => {
      const row = db
        .select({ content: skillFiles.content })
        .from(skillFiles)
        .where(and(eq(skillFiles.skillFqn, id), eq(skillFiles.relPath, relPath)))
        .get();
      return row?.content ?? null;
    });
  }
}
