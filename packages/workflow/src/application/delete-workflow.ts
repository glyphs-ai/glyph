import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowSandbox } from "../infrastructure/file/workflow-sandbox.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const DeleteWorkflowRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, purgeDir: z.boolean().optional() })
  .strict();
export type DeleteWorkflowRequest = z.infer<typeof DeleteWorkflowRequestSchema>;
export const DeleteWorkflowResponseSchema = z.undefined();
export type DeleteWorkflowResponse = z.infer<typeof DeleteWorkflowResponseSchema>;
export type WorkflowDeleteRequiresTerminal = {
  readonly type: "WorkflowDeleteRequiresTerminal";
  readonly workflowId: string;
  readonly status: string;
};
export type DeleteWorkflowError =
  | WorkflowNotFound
  | WorkflowEntityCorruption
  | WorkflowDeleteRequiresTerminal
  | DatabaseUnavailable;
export interface DeleteWorkflowDeps {
  readonly repo: WorkflowRepository;
  readonly sandbox: WorkflowSandbox;
}
export class DeleteWorkflowUseCase
  implements UseCase<DeleteWorkflowRequest, DeleteWorkflowResponse, DeleteWorkflowError>
{
  constructor(private readonly deps: DeleteWorkflowDeps) {}
  execute(
    request: DeleteWorkflowRequest,
  ): UseCaseResult<DeleteWorkflowResponse, DeleteWorkflowError> {
    const parsed = DeleteWorkflowRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const deleted = workflow.value.markDeleted();
        if (deleted.isErr()) return err(deleted.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        if (parsed.purgeDir === true)
          await ResultAsync.fromSafePromise(this.deps.sandbox.remove(parsed.workflowId));
        return ok(undefined);
      })(),
    );
  }
}
