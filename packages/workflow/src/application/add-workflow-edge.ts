import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import type { WorkflowEntityCorruption } from "../domain/workflow/workflow-corruption.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type {
  EdgeCycle,
  MultipleSuccessorCoords,
  OrphanCoordInsert,
  ParentState,
  WorkflowNodeNotMutable,
} from "../domain/workflow/workflow-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowNodeNotFound,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const AddWorkflowEdgeRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    fromNodeId: WorkflowNodeIdSchema,
    toNodeId: WorkflowNodeIdSchema,
  })
  .strict();
export type AddWorkflowEdgeRequest = z.infer<typeof AddWorkflowEdgeRequestSchema>;
export const AddWorkflowEdgeResponseSchema = z.object({ toPhase: z.number() });
export type AddWorkflowEdgeResponse = z.infer<typeof AddWorkflowEdgeResponseSchema>;
export type AddWorkflowEdgeError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | ParentState
  | EdgeCycle
  | OrphanCoordInsert
  | MultipleSuccessorCoords
  | DatabaseUnavailable;
export interface AddWorkflowEdgeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
}
export class AddWorkflowEdgeUseCase
  implements UseCase<AddWorkflowEdgeRequest, AddWorkflowEdgeResponse, AddWorkflowEdgeError>
{
  constructor(private readonly deps: AddWorkflowEdgeDeps) {}
  execute(
    request: AddWorkflowEdgeRequest,
  ): UseCaseResult<AddWorkflowEdgeResponse, AddWorkflowEdgeError> {
    const parsed = AddWorkflowEdgeRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const added = workflow.value.addEdge(parsed.fromNodeId, parsed.toNodeId);
        if (added.isErr()) return err(added.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        const toPhase =
          workflow.value.nodes.find((node) => node.id === parsed.toNodeId)?.phase ?? 0;
        return ok({ toPhase });
      })(),
    );
  }
}
