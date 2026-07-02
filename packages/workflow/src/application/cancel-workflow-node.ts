import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import { WORKER_KIND } from "../domain/node/workflow-node-kind.js";
import type { WorkflowEntityCorruption } from "../domain/workflow/workflow-corruption.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import {
  type WorkflowNodeNotMutable,
  workflowNodeNotMutable,
} from "../domain/workflow/workflow-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowNodeNotFound,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import { runnerFor, type WorkflowRunners } from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CancelWorkflowNodeRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, nodeId: WorkflowNodeIdSchema })
  .strict();
export type CancelWorkflowNodeRequest = z.infer<typeof CancelWorkflowNodeRequestSchema>;
export type CancelWorkflowNodeResponse = undefined;
export type CancelWorkflowNodeError =
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | DatabaseUnavailable;
export interface CancelWorkflowNodeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly runners: WorkflowRunners;
  readonly now: () => Date;
}
export class CancelWorkflowNodeUseCase
  implements UseCase<CancelWorkflowNodeRequest, CancelWorkflowNodeResponse, CancelWorkflowNodeError>
{
  constructor(private readonly deps: CancelWorkflowNodeDeps) {}
  execute(
    request: CancelWorkflowNodeRequest,
  ): UseCaseResult<CancelWorkflowNodeResponse, CancelWorkflowNodeError> {
    const parsed = CancelWorkflowNodeRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const node = workflow.value.nodes.find((candidate) => candidate.id === parsed.nodeId);
        if (node === undefined)
          return err({
            type: "WorkflowNodeNotFound",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
          });
        // Coord-kind cancellation is deferred: cancel the workflow instead via
        // cancelWorkflow. cancelNode is a worker-only verb.
        if (node.kind !== WORKER_KIND)
          return err(
            workflowNodeNotMutable(parsed.workflowId, parsed.nodeId, node.status, "cancelNode"),
          );
        if (node.status !== "not_started" && node.status !== "ready" && node.status !== "running")
          return err(
            workflowNodeNotMutable(parsed.workflowId, parsed.nodeId, node.status, "cancelNode"),
          );
        const terminal = workflow.value.markNodeTerminal(
          parsed.nodeId,
          "cancelled",
          "cancelNode",
          this.deps.now().toISOString(),
        );
        if (terminal.isErr())
          return err(
            workflowNodeNotMutable(parsed.workflowId, parsed.nodeId, node.status, "cancelNode"),
          );
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        // Best-effort: the DB already committed the cancellation. A runner.cancel
        // failure is swallowed (the substrate state remains cancelled) rather than
        // propagated out of execute().
        if (node.status === "running")
          await ResultAsync.fromPromise(
            runnerFor(this.deps.runners, node.kind).cancel(parsed.nodeId),
            (cause) => cause,
          );
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
}
