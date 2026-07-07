import { err, ok, type Result, safeTry } from "neverthrow";
import { z } from "zod";
import { generateWorkflowNodeId, WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import { COORDINATOR_KIND } from "../domain/node/workflow-node-kind.js";
import { CoordinatorAgentSchema } from "../domain/workflow/coordinator-agent.js";
import { WorkflowBriefSchema } from "../domain/workflow/workflow-brief.js";
import {
  type WorkflowAlreadyTerminal,
  WorkflowEntity,
} from "../domain/workflow/workflow-entity.js";
import type {
  EmptyParents,
  WorkflowDagConflict,
  WorkflowNodeNotFound,
} from "../domain/workflow/workflow-entity-errors.js";
import { generateWorkflowId, WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import { WorkflowOriginSchema } from "../domain/workflow/workflow-origin.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { WorkflowSandbox } from "../infrastructure/file/workflow-sandbox.js";
import type { WorkflowDispatchCoordinator } from "./engine/workflow-engine.js";
import { runnerFor, type WorkflowRunners } from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

export const CreateWorkflowRequestSchema = z
  .object({
    brief: WorkflowBriefSchema,
    details: z.string().optional(),
    coordinatorAgent: CoordinatorAgentSchema,
    origin: WorkflowOriginSchema.optional(),
    originId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
// `z.input`: `brief` is a WorkflowBrief value object (transform + brand), so the
// caller-facing request keeps it as a raw `string` — the use-case's own
// `.parse()` validates and brands it. Consumers get the branded value out.
export type CreateWorkflowRequest = z.input<typeof CreateWorkflowRequestSchema>;
export const CreateWorkflowResponseSchema = z.object({
  workflowId: WorkflowIdSchema,
  initialCoordNodeId: WorkflowNodeIdSchema,
});
export type CreateWorkflowResponse = z.infer<typeof CreateWorkflowResponseSchema>;
export type NodeSpecError = {
  readonly type: "NodeSpecError";
  readonly nodeKind: string;
  readonly reason: string;
  readonly cause?: unknown;
};
export type WorkflowDirReservationFailed = {
  readonly type: "WorkflowDirReservationFailed";
  readonly workflowId: string;
  readonly dir: string;
  readonly cause: unknown;
};
export type CreateWorkflowError =
  | NodeSpecError
  | WorkflowDirReservationFailed
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowAlreadyTerminal
  | DatabaseUnavailable
  | WorkflowDagConflict
  | EmptyParents;
export interface CreateWorkflowDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly runners: WorkflowRunners;
  readonly sandbox: WorkflowSandbox;
  readonly now: () => Date;
  readonly randomBytes: (n: number) => Buffer;
  readonly randomUUID: () => string;
}

export class CreateWorkflowUseCase
  implements UseCase<CreateWorkflowRequest, CreateWorkflowResponse, CreateWorkflowError>
{
  constructor(private readonly deps: CreateWorkflowDeps) {}
  execute(
    request: CreateWorkflowRequest,
  ): UseCaseResult<CreateWorkflowResponse, CreateWorkflowError> {
    const parsed = CreateWorkflowRequestSchema.parse(request);
    const deps = this.deps;
    const workflowId = generateWorkflowId(deps.now, deps.randomBytes);
    const initialCoordNodeId = generateWorkflowNodeId(deps.randomUUID);
    const nowIso = deps.now().toISOString();
    const runner = runnerFor(deps.runners, COORDINATOR_KIND);
    return safeTry<CreateWorkflowResponse, CreateWorkflowError>(async function* () {
      const validated = yield* runner
        .validate(
          { agent: parsed.coordinatorAgent },
          { workflowId, workflowStatus: "running", coordinatorAgent: parsed.coordinatorAgent },
        )
        .mapErr(
          (fault): NodeSpecError => ({
            type: "NodeSpecError",
            nodeKind: COORDINATOR_KIND,
            reason: errorReason(fault.cause),
            cause: fault.cause,
          }),
        );
      const spec = assertCoordinatorSpecAgent(validated, COORDINATOR_KIND);
      if (spec.isErr()) return err(spec.error);
      const wfDir = deps.sandbox.workflowDir(workflowId);
      yield* deps.sandbox.reserve(workflowId).mapErr(
        (cause): WorkflowDirReservationFailed => ({
          type: "WorkflowDirReservationFailed",
          workflowId,
          dir: wfDir,
          cause,
        }),
      );
      const workflow = WorkflowEntity.create({
        id: workflowId,
        brief: parsed.brief,
        ...(parsed.details !== undefined ? { details: parsed.details } : {}),
        coordinatorAgent: spec.value.agent,
        ...(parsed.origin !== undefined ? { origin: parsed.origin } : {}),
        ...(parsed.originId !== undefined ? { originId: parsed.originId } : {}),
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        createdAt: nowIso,
      });
      const added = workflow.addNode({
        nodeId: initialCoordNodeId,
        kind: COORDINATOR_KIND,
        validatedSpec: spec.value,
        parents: [],
        nowIso,
      });
      if (added.isErr()) {
        await deps.sandbox.remove(workflowId);
        return err(added.error);
      }
      const saved = await deps.repo.save(workflow);
      if (saved.isErr()) {
        await deps.sandbox.remove(workflowId);
        return err(saved.error);
      }
      yield* deps.coordinator.dispatch(workflowId, initialCoordNodeId);
      deps.coordinator.triggerWorkflowTick(workflowId);
      return ok({ workflowId, initialCoordNodeId });
    });
  }
}

export function assertCoordinatorSpecAgent(
  spec: unknown,
  nodeKind: string,
): Result<{ readonly agent: string }, NodeSpecError> {
  if (typeof spec !== "object" || spec === null)
    return err({ type: "NodeSpecError", nodeKind, reason: "coordinator spec must be an object" });
  const agent = (spec as { readonly agent?: unknown }).agent;
  if (typeof agent !== "string" || agent.length === 0)
    return err({
      type: "NodeSpecError",
      nodeKind,
      reason: "coordinator spec must include a non-empty agent",
    });
  return ok({ ...(spec as Record<string, unknown>), agent });
}

function errorReason(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown error";
}
