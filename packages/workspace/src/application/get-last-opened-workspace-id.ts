import pino, { type Logger } from "pino";
import { z } from "zod";
import { WorkspaceIdSchema } from "../domain/workspace-id.js";
import type { DatabaseUnavailable, WorkspaceRepository } from "../domain/workspace-repository.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const GetLastOpenedWorkspaceIdRequestSchema = z.object({}).strict();
export type GetLastOpenedWorkspaceIdRequest = z.infer<typeof GetLastOpenedWorkspaceIdRequestSchema>;

export const GetLastOpenedWorkspaceIdResponseSchema = z.object({
  id: WorkspaceIdSchema.nullable(),
});
export type GetLastOpenedWorkspaceIdResponse = z.infer<
  typeof GetLastOpenedWorkspaceIdResponseSchema
>;

export type GetLastOpenedWorkspaceIdError = DatabaseUnavailable;

export interface GetLastOpenedWorkspaceIdDeps {
  readonly repo: WorkspaceRepository;
  readonly logger?: Logger;
}

const silentLogger: Logger = pino({ level: "silent" });

/**
 * Cheap variant of `GetLastOpenedWorkspaceUseCase` that returns just
 * the id (or `null` when empty). The HTTP `/current` route + bootstrap
 * paths only need the routing key, so this avoids hydrating the full
 * row.
 */
export class GetLastOpenedWorkspaceIdUseCase
  implements
    UseCase<
      GetLastOpenedWorkspaceIdRequest,
      GetLastOpenedWorkspaceIdResponse,
      GetLastOpenedWorkspaceIdError
    >
{
  private readonly logger: Logger;
  constructor(private readonly deps: GetLastOpenedWorkspaceIdDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  execute(
    request: GetLastOpenedWorkspaceIdRequest,
  ): UseCaseResult<GetLastOpenedWorkspaceIdResponse, GetLastOpenedWorkspaceIdError> {
    GetLastOpenedWorkspaceIdRequestSchema.parse(request);
    return this.deps.repo
      .findLastOpenedId()
      .map((id): GetLastOpenedWorkspaceIdResponse => ({ id: id ?? null }))
      .mapErr((err) => {
        this.logger.warn({ useCase: "getLastOpenedWorkspaceId", err }, "tech failure");
        return err;
      });
  }
}
