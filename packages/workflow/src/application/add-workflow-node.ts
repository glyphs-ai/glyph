import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import {
  generateWorkflowNodeId,
  type WorkflowNodeId,
  WorkflowNodeIdSchema,
} from "../domain/node/workflow-node-id.js";
import {
  COORDINATOR_KIND,
  type WorkflowNodeKind,
  WorkflowNodeKindSchema,
} from "../domain/node/workflow-node-kind.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type {
  EmptyParents,
  MultipleSuccessorCoords,
  OrphanCoordInsert,
  ParentState,
  WorkflowNodeNotFound,
} from "../domain/workflow/workflow-entity-errors.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import { assertCoordinatorSpecAgent, type NodeSpecError } from "./create-workflow.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import {
  runnerFor,
  type WorkflowNodeValidateCtx,
  type WorkflowRunners,
} from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const AddWorkflowNodeRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    kind: WorkflowNodeKindSchema,
    spec: z.unknown(),
    parents: z.array(WorkflowNodeIdSchema).readonly(),
  })
  .strict();
export type AddWorkflowNodeRequest = z.infer<typeof AddWorkflowNodeRequestSchema>;
export const AddWorkflowNodeResponseSchema = z.object({
  nodeId: WorkflowNodeIdSchema,
  phase: z.number(),
});
export type AddWorkflowNodeResponse = z.infer<typeof AddWorkflowNodeResponseSchema>;
export type AddWorkflowNodeError =
  | EmptyParents
  | NodeSpecError
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | ParentState
  | OrphanCoordInsert
  | MultipleSuccessorCoords
  | DatabaseUnavailable;
export interface AddWorkflowNodeDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly runners: WorkflowRunners;
  readonly now: () => Date;
  readonly randomUUID: () => string;
}
export class AddWorkflowNodeUseCase
  implements UseCase<AddWorkflowNodeRequest, AddWorkflowNodeResponse, AddWorkflowNodeError>
{
  constructor(private readonly deps: AddWorkflowNodeDeps) {}
  execute(
    request: AddWorkflowNodeRequest,
  ): UseCaseResult<AddWorkflowNodeResponse, AddWorkflowNodeError> {
    const parsed = AddWorkflowNodeRequestSchema.parse(request);
    if (parsed.parents.length === 0) return errAsync({ type: "EmptyParents" });
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const validated = await validateNodeSpec({
          runners: this.deps.runners,
          kind: parsed.kind,
          spec: parsed.spec,
          ctx: {
            workflowId: parsed.workflowId,
            workflowStatus: "running",
            coordinatorAgent: workflow.value.coordinatorAgent,
          },
        });
        if (validated.isErr()) return err(validated.error);
        const spec =
          parsed.kind === COORDINATOR_KIND
            ? assertCoordinatorSpecAgent(validated.value, parsed.kind)
            : ok(validated.value);
        if (spec.isErr()) return err(spec.error);
        const added = workflow.value.addNode({
          nodeId: generateWorkflowNodeId(this.deps.randomUUID),
          kind: parsed.kind,
          validatedSpec: spec.value,
          parents: uniqueNodeIds(parsed.parents),
          nowIso: this.deps.now().toISOString(),
        });
        if (added.isErr()) return err(added.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok({ nodeId: added.value.nodeId, phase: added.value.phase });
      })(),
    );
  }
}

function uniqueNodeIds(ids: readonly WorkflowNodeId[]): WorkflowNodeId[] {
  return Array.from(new Set(ids));
}

function validateNodeSpec(args: {
  readonly runners: WorkflowRunners;
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly ctx: WorkflowNodeValidateCtx;
}): ResultAsync<unknown, NodeSpecError> {
  return ResultAsync.fromPromise(
    runnerFor(args.runners, args.kind).validate(args.spec, args.ctx),
    (cause): NodeSpecError => ({
      type: "NodeSpecError",
      nodeKind: args.kind,
      reason: errorReason(cause),
      cause,
    }),
  );
}

function errorReason(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown error";
}
