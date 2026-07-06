import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { HumanNodeResponseSchema, type HumanNodeSpec } from "../domain/node/workflow-human-node.js";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import { HUMAN_KIND, WorkflowNodeKindSchema } from "../domain/node/workflow-node-kind.js";
import { WorkflowNodeStatusSchema } from "../domain/node/workflow-node-status.js";
import type { WorkflowNodeNotFound } from "../domain/workflow/workflow-entity-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const RespondToHumanNodeRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    nodeId: WorkflowNodeIdSchema,
    response: HumanNodeResponseSchema,
  })
  .strict();
export type RespondToHumanNodeRequest = z.infer<typeof RespondToHumanNodeRequestSchema>;
export const RespondToHumanNodeResponseSchema = z.object({
  id: WorkflowNodeIdSchema,
  workflowId: WorkflowIdSchema,
  kind: WorkflowNodeKindSchema,
  spec: z.unknown(),
  phase: z.number(),
  status: WorkflowNodeStatusSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readyAt: z.string().optional(),
  runningAt: z.string().optional(),
  endedAt: z.string().optional(),
});
export type RespondToHumanNodeResponse = z.infer<typeof RespondToHumanNodeResponseSchema>;
export type HumanNodeResponseInvalid = {
  readonly type: "HumanNodeResponseInvalid";
  readonly workflowId: string;
  readonly nodeId: string;
  readonly reason: string;
};
export type RespondToHumanNodeError =
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | HumanNodeResponseInvalid
  | DatabaseUnavailable;
export interface RespondToHumanNodeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly now: () => Date;
}
export class RespondToHumanNodeUseCase
  implements UseCase<RespondToHumanNodeRequest, RespondToHumanNodeResponse, RespondToHumanNodeError>
{
  constructor(private readonly deps: RespondToHumanNodeDeps) {}
  execute(
    request: RespondToHumanNodeRequest,
  ): UseCaseResult<RespondToHumanNodeResponse, RespondToHumanNodeError> {
    const parsed = RespondToHumanNodeRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) {
          if (workflow.error.type === "WorkflowNotFound")
            return err({
              type: "WorkflowNodeNotFound",
              workflowId: parsed.workflowId,
              nodeId: parsed.nodeId,
            });
          return err(workflow.error);
        }
        const node = workflow.value.nodes.find((candidate) => candidate.id === parsed.nodeId);
        if (node === undefined)
          return err({
            type: "WorkflowNodeNotFound",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
          });
        if (node.kind !== HUMAN_KIND)
          return err({
            type: "HumanNodeResponseInvalid",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
            reason: `node is kind ${node.kind}, not human`,
          });
        if (node.status !== "running")
          return err({
            type: "HumanNodeResponseInvalid",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
            reason: `node status is ${node.status}, expected running`,
          });
        const spec = node.spec as HumanNodeSpec;
        if (parsed.response.choiceId !== undefined) {
          const choices = new Set((spec.choices ?? []).map((choice) => choice.id));
          if (!choices.has(parsed.response.choiceId))
            return err({
              type: "HumanNodeResponseInvalid",
              workflowId: parsed.workflowId,
              nodeId: parsed.nodeId,
              reason: `choiceId ${parsed.response.choiceId} is not valid`,
            });
        } else if (
          parsed.response.input === undefined ||
          parsed.response.input.trim().length === 0
        ) {
          return err({
            type: "HumanNodeResponseInvalid",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
            reason: "freeform response requires non-empty input",
          });
        }
        const metadata = workflow.value.replaceNodeMetadata(parsed.nodeId, {
          ...node.metadata,
          response: parsed.response,
        });
        if (metadata.isErr()) return err(metadata.error);
        const terminal = workflow.value.markNodeTerminal(
          parsed.nodeId,
          "succeeded",
          this.deps.now().toISOString(),
        );
        if (terminal.isErr())
          return err({
            type: "HumanNodeResponseInvalid",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
            reason: terminal.error.type,
          });
        const updated = workflow.value.nodes.find((candidate) => candidate.id === parsed.nodeId);
        if (updated === undefined)
          return err({
            type: "WorkflowNodeNotFound",
            workflowId: parsed.workflowId,
            nodeId: parsed.nodeId,
          });
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok({
          id: updated.id,
          workflowId: updated.workflowId,
          kind: updated.kind,
          spec: updated.spec,
          phase: updated.phase,
          status: updated.status,
          metadata: updated.metadata,
          createdAt: updated.createdAt,
          ...(updated.readyAt !== undefined ? { readyAt: updated.readyAt } : {}),
          ...(updated.runningAt !== undefined ? { runningAt: updated.runningAt } : {}),
          ...(updated.endedAt !== undefined ? { endedAt: updated.endedAt } : {}),
        });
      })(),
    );
  }
}
