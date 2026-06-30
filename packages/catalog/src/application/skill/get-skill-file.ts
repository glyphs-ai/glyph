import { z } from "zod";
import type { DatabaseUnavailable } from "../../domain/agent-repository.js";
import { SkillFqnSchema } from "../../domain/skill-fqn.js";
import type { SkillRepository } from "../../domain/skill-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetSkillFileRequestSchema = z.object({ id: SkillFqnSchema, relPath: z.string() });
export type GetSkillFileRequest = z.infer<typeof GetSkillFileRequestSchema>;
export const GetSkillFileResponseSchema = z.custom<Buffer | null>();
export type GetSkillFileResponse = Buffer | null;
export type GetSkillFileError = DatabaseUnavailable;

export interface GetSkillFileDeps {
  readonly skillRepo: SkillRepository;
}

export class GetSkillFileUseCase
  implements UseCase<GetSkillFileRequest, GetSkillFileResponse, GetSkillFileError>
{
  constructor(private readonly deps: GetSkillFileDeps) {}

  execute(request: GetSkillFileRequest): UseCaseResult<GetSkillFileResponse, GetSkillFileError> {
    return this.deps.skillRepo.getFile(request.id, request.relPath);
  }
}
