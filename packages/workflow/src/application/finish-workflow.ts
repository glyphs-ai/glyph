import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import { WorkflowSuccessSchema } from "../domain/workflow/workflow-success.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

const CoordinatorFailureSchema = z.object({ kind: z.literal("coordinator"), message: z.string() });
export const FinishWorkflowRequestSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      workflowId: WorkflowIdSchema,
      outcome: z.literal("succeeded"),
      success: WorkflowSuccessSchema.optional(),
    })
    .strict(),
  z
    .object({
      workflowId: WorkflowIdSchema,
      outcome: z.literal("failed"),
      failure: CoordinatorFailureSchema,
    })
    .strict(),
]);
export type FinishWorkflowRequest = z.infer<typeof FinishWorkflowRequestSchema>;
export const FinishWorkflowResponseSchema = z.undefined();
export type FinishWorkflowResponse = z.infer<typeof FinishWorkflowResponseSchema>;
export type FinishWorkflowError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | DatabaseUnavailable;
export interface FinishWorkflowDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly now: () => Date;
}
export class FinishWorkflowUseCase
  implements UseCase<FinishWorkflowRequest, FinishWorkflowResponse, FinishWorkflowError>
{
  constructor(private readonly deps: FinishWorkflowDeps) {}
  execute(
    request: FinishWorkflowRequest,
  ): UseCaseResult<FinishWorkflowResponse, FinishWorkflowError> {
    const parsed = FinishWorkflowRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const terminal =
          parsed.outcome === "succeeded"
            ? workflow.value.succeed(
                parsed.success ?? { output: null },
                this.deps.now().toISOString(),
              )
            : workflow.value.fail(parsed.failure, this.deps.now().toISOString());
        if (terminal.isErr()) return err(terminal.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        await ResultAsync.fromSafePromise(
          this.deps.coordinator.reconcileCancel(parsed.workflowId, { excludeRunningCoords: true }),
        );
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
}
