import { z } from "zod";
import type { CatalogFileEntry, DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const ListSkillFilesRequestSchema = z.object({ id: SkillFqnSchema });
export type ListSkillFilesRequest = z.infer<typeof ListSkillFilesRequestSchema>;
export const ListSkillFilesResponseSchema = z.array(
  z.object({ relPath: z.string(), size: z.number() }),
);
export type ListSkillFilesResponse = CatalogFileEntry[];
export type ListSkillFilesError = DatabaseUnavailable;

export interface ListSkillFilesDeps {
  readonly skillRepo: SkillRepository;
}

export class ListSkillFilesUseCase
  implements UseCase<ListSkillFilesRequest, ListSkillFilesResponse, ListSkillFilesError>
{
  constructor(private readonly deps: ListSkillFilesDeps) {}

  async execute(
    request: ListSkillFilesRequest,
  ): UseCaseResult<ListSkillFilesResponse, ListSkillFilesError> {
    return this.deps.skillRepo.listFilePaths(request.id);
  }
}
