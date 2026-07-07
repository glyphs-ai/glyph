import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import {
  HUMAN_MAX_CHOICES,
  HumanNodeChoiceSchema,
  HumanNodePromptStyleSchema,
} from "../domain/node/workflow-human-node.js";
import type { WorkflowNodeEntity } from "../domain/node/workflow-node-entity.js";
import { WorkflowNodeIdSchema } from "../domain/node/workflow-node-id.js";
import { HUMAN_KIND, WORKER_KIND } from "../domain/node/workflow-node-kind.js";
import {
  assertNodeSpecUpdatable,
  type NodeSpecUpdateGuardError,
} from "../domain/node/workflow-node-spec-update.js";
import type { WorkflowAlreadyTerminal } from "../domain/workflow/workflow-entity.js";
import { WorkflowIdSchema } from "../domain/workflow/workflow-id.js";
import type {
  DatabaseUnavailable,
  WorkflowEntityCorruption,
  WorkflowNotFound,
  WorkflowRepository,
} from "../domain/workflow/workflow-repository.js";
import type { NodeSpecError } from "./create-workflow.js";
import {
  type GetWorkflowNodeResponse,
  GetWorkflowNodeResponseSchema,
} from "./get-workflow-node.js";
import { runnerFor, type WorkflowRunners } from "./ports/workflow-node-runner.js";
import type { UseCase, UseCaseResult } from "./use-case.js";

/**
 * Upper bound on a patched worker `brief`, mirroring the workflow/task brief
 * invariant. Deliberately a LOCAL, non-branded check rather than an import of
 * the task pkg's `TaskBriefSchema`: the workflow pkg (T0) must not depend on the
 * task pkg. The runner still performs the authoritative brief validation on the
 * merged spec; this boundary refine just rejects an obviously-bad brief with a
 * clean 400 before any IO-bound runner work.
 */
const WORKER_BRIEF_MAX_LENGTH = 200;
const WorkerBriefPatchSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "brief must be non-empty after trim")
  .refine(
    (s) => !s.includes("\n") && !s.includes("\r"),
    "brief must be a single line (no newline characters); pass long content via details",
  )
  .refine(
    (s) => s.trim().length <= WORKER_BRIEF_MAX_LENGTH,
    `brief must be ${WORKER_BRIEF_MAX_LENGTH} characters or fewer`,
  );

const nonEmptyPatch = (patch: Record<string, unknown>): boolean => Object.keys(patch).length > 0;
const EMPTY_PATCH_MESSAGE = "spec patch must set at least one field";

/**
 * Whitelisted worker-node spec patch. `.strict()` rejects unknown keys so a
 * caller can only touch the fields a worker spec actually owns; every field is
 * optional but the patch must set at least one.
 */
export const WorkerSpecPatchSchema = z
  .object({
    agent: z.string().min(1),
    brief: WorkerBriefPatchSchema,
    details: z.string(),
    runtime: z.string().min(1),
  })
  .partial()
  .strict()
  .refine(nonEmptyPatch, EMPTY_PATCH_MESSAGE);
export type WorkerSpecPatch = z.infer<typeof WorkerSpecPatchSchema>;

/**
 * Whitelisted human-node spec patch. Reuses the domain `promptStyle` enum and
 * `choice` shape so the patch surface can never drift from the human spec.
 */
export const HumanSpecPatchSchema = z
  .object({
    prompt: z.string().min(1),
    promptStyle: HumanNodePromptStyleSchema,
    choices: z.array(HumanNodeChoiceSchema).max(HUMAN_MAX_CHOICES).readonly(),
  })
  .partial()
  .strict()
  .refine(nonEmptyPatch, EMPTY_PATCH_MESSAGE);
export type HumanSpecPatch = z.infer<typeof HumanSpecPatchSchema>;

/**
 * Body discriminant: the target kind selects both the patch whitelist and the
 * runner used to validate the merged spec. Coordinator is intentionally absent
 * — coordinator specs are not editable through this path.
 */
const UpdateWorkflowNodeSpecTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(WORKER_KIND), patch: WorkerSpecPatchSchema }).strict(),
  z.object({ kind: z.literal(HUMAN_KIND), patch: HumanSpecPatchSchema }).strict(),
]);

export const UpdateWorkflowNodeSpecRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    nodeId: WorkflowNodeIdSchema,
    expectedSpecVersion: z.number().int().nonnegative(),
    target: UpdateWorkflowNodeSpecTargetSchema,
  })
  .strict();
export type UpdateWorkflowNodeSpecRequest = z.infer<typeof UpdateWorkflowNodeSpecRequestSchema>;

/**
 * Response wraps the patched single-node view with the post-patch
 * `newSpecVersion` (always equal to `node.specVersion`) so a caller can thread
 * the next optimistic-concurrency token without an extra read.
 */
export const UpdateWorkflowNodeSpecResponseSchema = z
  .object({
    node: GetWorkflowNodeResponseSchema,
    newSpecVersion: z.number().int().nonnegative(),
  })
  .strict();
export type UpdateWorkflowNodeSpecResponse = z.infer<typeof UpdateWorkflowNodeSpecResponseSchema>;

export type UpdateWorkflowNodeSpecError =
  | NodeSpecUpdateGuardError
  | NodeSpecError
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | DatabaseUnavailable;

export interface UpdateWorkflowNodeSpecDeps {
  readonly repo: WorkflowRepository;
  readonly runners: WorkflowRunners;
}

/**
 * Apply a partial spec patch to a single still-`not_started` worker/human node.
 *
 * Flow: load the aggregate → refuse a terminal workflow → run the shared
 * precondition guard (existence / not-coordinator / kind-match / not-started /
 * specVersion) so the runner is chosen for the right kind and any structural
 * reject happens before IO → shallow-merge `{...currentSpec, ...patch}` →
 * validate the merged spec through the target kind's runner (full validation,
 * exactly as create/add-subgraph do) → mutate the aggregate (bumping
 * `specVersion`) → save. A rejected patch performs no write. Unlike
 * add/prune-subgraph this does NOT nudge the engine: patching a `not_started`
 * node's spec cannot make it newly dispatch-eligible.
 */
export class UpdateWorkflowNodeSpecUseCase
  implements
    UseCase<
      UpdateWorkflowNodeSpecRequest,
      UpdateWorkflowNodeSpecResponse,
      UpdateWorkflowNodeSpecError
    >
{
  constructor(private readonly deps: UpdateWorkflowNodeSpecDeps) {}
  execute(
    request: UpdateWorkflowNodeSpecRequest,
  ): UseCaseResult<UpdateWorkflowNodeSpecResponse, UpdateWorkflowNodeSpecError> {
    const parsed = UpdateWorkflowNodeSpecRequestSchema.parse(request);
    const { workflowId, nodeId, expectedSpecVersion, target } = parsed;
    return new ResultAsync(
      (async () => {
        const workflow = await this.deps.repo.get(workflowId);
        if (workflow.isErr()) return err(workflow.error);
        const wf = workflow.value;
        // Terminal-workflow rejection ahead of the runner so a patch on a
        // finished workflow never spends an IO-bound validate.
        if (wf.status !== "running")
          return err({
            type: "WorkflowAlreadyTerminal" as const,
            workflowId,
            status: wf.status,
          });
        // Structural guard before validate: picks the runner for the correct
        // kind and surfaces coord/kind/status/version rejects ahead of any
        // spec-shape error.
        const guarded = assertNodeSpecUpdatable({
          workflowId,
          nodeId,
          node: wf.nodes.find((n) => n.id === nodeId),
          expectedKind: target.kind,
          expectedSpecVersion,
        });
        if (guarded.isErr()) return err(guarded.error);
        const merged = mergeSpec(guarded.value.spec, target.patch);
        const validated = await runnerFor(this.deps.runners, target.kind)
          .validate(merged, {
            workflowId,
            workflowStatus: "running",
            coordinatorAgent: wf.coordinatorAgent,
          })
          .mapErr(
            (fault): NodeSpecError => ({
              type: "NodeSpecError",
              nodeKind: target.kind,
              reason: errorReason(fault.cause),
              cause: fault.cause,
            }),
          );
        if (validated.isErr()) return err(validated.error);
        const updated = wf.updateNodeSpec({
          nodeId,
          expectedKind: target.kind,
          expectedSpecVersion,
          validatedSpec: validated.value,
        });
        if (updated.isErr()) return err(updated.error);
        const saved = await this.deps.repo.save(wf);
        if (saved.isErr()) return err(saved.error);
        return ok({
          node: toNodeView(updated.value),
          newSpecVersion: updated.value.specVersion,
        });
      })(),
    );
  }
}

/** Shallow-merge a patch onto the current spec, coercing a non-object spec to `{}`. */
function mergeSpec(currentSpec: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base =
    currentSpec !== null && typeof currentSpec === "object" && !Array.isArray(currentSpec)
      ? (currentSpec as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

function toNodeView(node: WorkflowNodeEntity): GetWorkflowNodeResponse {
  return {
    id: node.id,
    workflowId: node.workflowId,
    kind: node.kind,
    spec: node.spec,
    phase: node.phase,
    status: node.status,
    metadata: { ...node.metadata },
    createdAt: node.createdAt,
    ...(node.readyAt !== undefined ? { readyAt: node.readyAt } : {}),
    ...(node.runningAt !== undefined ? { runningAt: node.runningAt } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
    specVersion: node.specVersion,
  };
}

function errorReason(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown error";
}
