import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type { WorkflowPruneRejected } from "../domain/workflow/workflow-entity-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const PruneWorkflowSubgraphRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    nodeIds: z.array(WorkflowNodeIdSchema).min(1).readonly(),
  })
  .strict();
export type PruneWorkflowSubgraphRequest = z.infer<typeof PruneWorkflowSubgraphRequestSchema>;

export const PruneWorkflowSubgraphResponseSchema = z.object({
  prunedNodeIds: z.array(WorkflowNodeIdSchema).readonly(),
  prunedEdges: z
    .array(z.object({ from: WorkflowNodeIdSchema, to: WorkflowNodeIdSchema }).strict())
    .readonly(),
});
export type PruneWorkflowSubgraphResponse = z.infer<typeof PruneWorkflowSubgraphResponseSchema>;

export type PruneWorkflowSubgraphError =
  | WorkflowPruneRejected
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | DatabaseUnavailable;

export interface PruneWorkflowSubgraphDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
}

/**
 * Retract a batch of still-`not_started` nodes (and their adjacent edges) from a
 * running workflow — the structural inverse of {@link AddWorkflowSubgraphUseCase}.
 * The aggregate rejects the whole batch before any write when a target is
 * missing / already started / the root coord, or when the post-removal graph
 * would orphan a survivor or break a coord chain. A successful prune is one save
 * followed by a tick nudge (for symmetry with add-subgraph — pruning
 * `not_started` nodes cannot itself create newly-eligible dispatch candidates).
 */
export class PruneWorkflowSubgraphUseCase
  implements
    UseCase<PruneWorkflowSubgraphRequest, PruneWorkflowSubgraphResponse, PruneWorkflowSubgraphError>
{
  constructor(private readonly deps: PruneWorkflowSubgraphDeps) {}
  execute(
    request: PruneWorkflowSubgraphRequest,
  ): UseCaseResult<PruneWorkflowSubgraphResponse, PruneWorkflowSubgraphError> {
    const parsed = PruneWorkflowSubgraphRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const pruned = workflow.value.pruneSubgraph({ nodeIds: parsed.nodeIds });
        if (pruned.isErr()) return err(pruned.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok({
          prunedNodeIds: pruned.value.prunedNodeIds,
          prunedEdges: pruned.value.prunedEdges,
        });
      })(),
    );
  }
}
