import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowCancellationSchema } from "../domain/workflow/workflow-cancellation.js";
import type { WorkflowEntityCorruption } from "../domain/workflow/workflow-corruption.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CancelWorkflowRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, cancellation: WorkflowCancellationSchema })
  .strict();
export type CancelWorkflowRequest = z.infer<typeof CancelWorkflowRequestSchema>;
export type CancelWorkflowResponse = undefined;
export type CancelWorkflowError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | DatabaseUnavailable;
export interface CancelWorkflowDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly now: () => Date;
}
export class CancelWorkflowUseCase
  implements UseCase<CancelWorkflowRequest, CancelWorkflowResponse, CancelWorkflowError>
{
  constructor(private readonly deps: CancelWorkflowDeps) {}
  execute(
    request: CancelWorkflowRequest,
  ): UseCaseResult<CancelWorkflowResponse, CancelWorkflowError> {
    const parsed = CancelWorkflowRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const cancelled = workflow.value.cancel(parsed.cancellation, this.deps.now().toISOString());
        if (cancelled.isErr()) return err(cancelled.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        await ResultAsync.fromSafePromise(
          this.deps.coordinator.reconcileCancel(parsed.workflowId, { excludeRunningCoords: false }),
        );
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
}
