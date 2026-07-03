import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type {
  RemoveEdgeOrphansChild,
  WorkflowEdgeNotFound,
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

export const RemoveWorkflowEdgeRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    fromNodeId: WorkflowNodeIdSchema,
    toNodeId: WorkflowNodeIdSchema,
  })
  .strict();
export type RemoveWorkflowEdgeRequest = z.infer<typeof RemoveWorkflowEdgeRequestSchema>;
export type RemoveWorkflowEdgeResponse = undefined;
export type RemoveWorkflowEdgeError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | WorkflowEdgeNotFound
  | RemoveEdgeOrphansChild
  | DatabaseUnavailable;
export interface RemoveWorkflowEdgeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
}
export class RemoveWorkflowEdgeUseCase
  implements UseCase<RemoveWorkflowEdgeRequest, RemoveWorkflowEdgeResponse, RemoveWorkflowEdgeError>
{
  constructor(private readonly deps: RemoveWorkflowEdgeDeps) {}
  execute(
    request: RemoveWorkflowEdgeRequest,
  ): UseCaseResult<RemoveWorkflowEdgeResponse, RemoveWorkflowEdgeError> {
    const parsed = RemoveWorkflowEdgeRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const removed = workflow.value.removeEdge(parsed.fromNodeId, parsed.toNodeId);
        if (removed.isErr()) return err(removed.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
}
