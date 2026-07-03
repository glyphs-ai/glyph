import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type {
  RemoveNodeOrphansChild,
  WorkflowNodeNotFound,
  WorkflowNodeNotMutable,
} from "../domain/workflow/workflow-entity-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RemoveWorkflowNodeRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, nodeId: WorkflowNodeIdSchema })
  .strict();
export type RemoveWorkflowNodeRequest = z.infer<typeof RemoveWorkflowNodeRequestSchema>;
export type RemoveWorkflowNodeResponse = undefined;
export type RemoveWorkflowNodeError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | RemoveNodeOrphansChild
  | DatabaseUnavailable;
export interface RemoveWorkflowNodeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
}
export class RemoveWorkflowNodeUseCase
  implements UseCase<RemoveWorkflowNodeRequest, RemoveWorkflowNodeResponse, RemoveWorkflowNodeError>
{
  constructor(private readonly deps: RemoveWorkflowNodeDeps) {}
  execute(
    request: RemoveWorkflowNodeRequest,
  ): UseCaseResult<RemoveWorkflowNodeResponse, RemoveWorkflowNodeError> {
    const parsed = RemoveWorkflowNodeRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const removed = workflow.value.removeNode(parsed.nodeId);
        if (removed.isErr()) return err(removed.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
}
export type { WorkflowNodeNotMutable } from "../domain/workflow/workflow-entity-errors.js";
