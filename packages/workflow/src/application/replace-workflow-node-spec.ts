import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import { COORDINATOR_KIND, type WorkflowNodeKind } from "../domain/node/workflow-node-kind.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import type {
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
import { assertCoordinatorSpecAgent, type NodeSpecError } from "./create-workflow.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import {
  runnerFor,
  type WorkflowNodeValidateCtx,
  type WorkflowRunners,
} from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const ReplaceWorkflowNodeSpecRequestSchema = z
  .object({ workflowId: WorkflowIdSchema, nodeId: WorkflowNodeIdSchema, newSpec: z.unknown() })
  .strict();
export type ReplaceWorkflowNodeSpecRequest = z.infer<typeof ReplaceWorkflowNodeSpecRequestSchema>;
export type ReplaceWorkflowNodeSpecResponse = undefined;
export type ReplaceWorkflowNodeSpecError =
  | NodeSpecError
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | DatabaseUnavailable;
export interface ReplaceWorkflowNodeSpecDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly runners: WorkflowRunners;
}
export class ReplaceWorkflowNodeSpecUseCase
  implements
    UseCase<
      ReplaceWorkflowNodeSpecRequest,
      ReplaceWorkflowNodeSpecResponse,
      ReplaceWorkflowNodeSpecError
    >
{
  constructor(private readonly deps: ReplaceWorkflowNodeSpecDeps) {}
  execute(
    request: ReplaceWorkflowNodeSpecRequest,
  ): UseCaseResult<ReplaceWorkflowNodeSpecResponse, ReplaceWorkflowNodeSpecError> {
    const parsed = ReplaceWorkflowNodeSpecRequestSchema.parse(request);
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
        const validated = await validateNodeSpec({
          runners: this.deps.runners,
          kind: node.kind,
          spec: parsed.newSpec,
          ctx: {
            workflowId: parsed.workflowId,
            workflowStatus: "running",
            coordinatorAgent: workflow.value.coordinatorAgent,
          },
        });
        if (validated.isErr()) return err(validated.error);
        const spec =
          node.kind === COORDINATOR_KIND
            ? assertCoordinatorSpecAgent(validated.value, node.kind)
            : ok(validated.value);
        if (spec.isErr()) return err(spec.error);
        const replaced = workflow.value.replaceNodeSpec(parsed.nodeId, spec.value);
        if (replaced.isErr()) return err(replaced.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok(undefined);
      })(),
    );
  }
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
