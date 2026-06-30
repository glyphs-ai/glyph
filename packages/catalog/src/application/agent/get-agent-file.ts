import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type { AgentRepository, DatabaseUnavailable } from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const GetAgentFileRequestSchema = z.object({ id: AgentFqnSchema, relPath: z.string() });
export type GetAgentFileRequest = z.infer<typeof GetAgentFileRequestSchema>;
export const GetAgentFileResponseSchema = z.custom<Buffer | null>();
export type GetAgentFileResponse = Buffer | null;
export type GetAgentFileError = DatabaseUnavailable;

export interface GetAgentFileDeps {
  readonly agentRepo: AgentRepository;
}

export class GetAgentFileUseCase
  implements UseCase<GetAgentFileRequest, GetAgentFileResponse, GetAgentFileError>
{
  constructor(private readonly deps: GetAgentFileDeps) {}

  execute(request: GetAgentFileRequest): UseCaseResult<GetAgentFileResponse, GetAgentFileError> {
    return this.deps.agentRepo.getFile(request.id, request.relPath);
  }
}
