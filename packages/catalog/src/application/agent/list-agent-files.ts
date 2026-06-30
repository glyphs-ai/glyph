import { z } from "zod";
import { AgentFqnSchema } from "../../domain/agent-fqn.js";
import type {
  AgentRepository,
  CatalogFileEntry,
  DatabaseUnavailable,
} from "../../domain/agent-repository.js";
import type { UseCase, UseCaseResult } from "../use-case.js";

export const ListAgentFilesRequestSchema = z.object({ id: AgentFqnSchema });
export type ListAgentFilesRequest = z.infer<typeof ListAgentFilesRequestSchema>;
export const ListAgentFilesResponseSchema = z.array(
  z.object({ relPath: z.string(), size: z.number() }),
);
export type ListAgentFilesResponse = CatalogFileEntry[];
export type ListAgentFilesError = DatabaseUnavailable;

export interface ListAgentFilesDeps {
  readonly agentRepo: AgentRepository;
}

export class ListAgentFilesUseCase
  implements UseCase<ListAgentFilesRequest, ListAgentFilesResponse, ListAgentFilesError>
{
  constructor(private readonly deps: ListAgentFilesDeps) {}

  execute(
    request: ListAgentFilesRequest,
  ): UseCaseResult<ListAgentFilesResponse, ListAgentFilesError> {
    return this.deps.agentRepo.listFilePaths(request.id);
  }
}
