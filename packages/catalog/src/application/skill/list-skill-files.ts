import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { CatalogFileEntry } from "../../domain/catalog-file.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { CatalogQueries } from "../../infrastructure/drizzle/catalog-queries.js";
import { skillFiles } from "../../infrastructure/drizzle/skill-schema.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const ListSkillFilesRequestSchema = z.object({ id: SkillFqnSchema });
export type ListSkillFilesRequest = z.infer<typeof ListSkillFilesRequestSchema>;
export const ListSkillFilesResponseSchema = z.array(
  z.object({ relPath: z.string(), size: z.number() }),
);
export type ListSkillFilesResponse = CatalogFileEntry[];
export type ListSkillFilesError = DatabaseUnavailable;

export interface ListSkillFilesDeps {
  readonly queries: CatalogQueries;
}

export class ListSkillFilesUseCase
  implements UseCase<ListSkillFilesRequest, ListSkillFilesResponse, ListSkillFilesError>
{
  constructor(private readonly deps: ListSkillFilesDeps) {}

  execute(
    request: ListSkillFilesRequest,
  ): UseCaseResult<ListSkillFilesResponse, ListSkillFilesError> {
    const { id } = request;
    return this.deps.queries.query(async (db) => {
      const rows = await db
        .select({ relPath: skillFiles.relPath, content: skillFiles.content })
        .from(skillFiles)
        .where(eq(skillFiles.skillFqn, id))
        .orderBy(skillFiles.relPath)
        .all();
      return rows.map((row) => ({ relPath: row.relPath, size: row.content.byteLength }));
    });
  }
}
