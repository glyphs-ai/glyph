import { ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type { WorkflowSandbox } from "../infrastructure/file/workflow-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const PurgeWorkflowRequestSchema = z.object({ workflowId: WorkflowIdSchema }).strict();
export type PurgeWorkflowRequest = z.infer<typeof PurgeWorkflowRequestSchema>;
export type PurgeWorkflowResponse = undefined;
export type PurgeWorkflowError = never;
export interface PurgeWorkflowDeps {
  readonly sandbox: WorkflowSandbox;
}
export class PurgeWorkflowUseCase
  implements UseCase<PurgeWorkflowRequest, PurgeWorkflowResponse, PurgeWorkflowError>
{
  constructor(private readonly deps: PurgeWorkflowDeps) {}
  execute(request: PurgeWorkflowRequest): UseCaseResult<PurgeWorkflowResponse, PurgeWorkflowError> {
    const { workflowId } = PurgeWorkflowRequestSchema.parse(request);
    return ResultAsync.fromSafePromise(this.deps.sandbox.remove(workflowId)).map(() => undefined);
  }
}
