import { err, ok, ResultAsync } from "neverthrow";
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
import type {
  NodeRef,
  SubgraphEdgeShape,
  SubgraphNodeInput,
  SubgraphTempNodeShape,
  WorkflowAlreadyTerminal,
} from "../domain/workflow/workflow-entity.js";
import {
  normalizeSubgraphInput,
  validateSubgraphShape,
} from "../domain/workflow/workflow-entity.js";
import type {
  SubgraphError,
  WorkflowDagConflict,
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

const NodeRefSchema: z.ZodType<NodeRef> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: WorkflowNodeIdSchema }),
  z.object({ kind: z.literal("temp"), tempId: z.string() }),
]);
const SubgraphNodeSchema = z
  .object({
    tempId: z.string(),
    kind: WorkflowNodeKindSchema,
    spec: z.unknown(),
    existingParents: z.array(WorkflowNodeIdSchema).readonly().optional(),
  })
  .strict();
const SubgraphEdgeSchema = z.object({ from: NodeRefSchema, to: NodeRefSchema }).strict();
export const AddWorkflowSubgraphRequestSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    nodes: z.array(SubgraphNodeSchema).readonly(),
    edges: z.array(SubgraphEdgeSchema).readonly(),
  })
  .strict();
export type AddWorkflowSubgraphRequest = z.infer<typeof AddWorkflowSubgraphRequestSchema>;
export const AddWorkflowSubgraphResponseSchema = z.object({
  insertedNodes: z
    .array(z.object({ tempId: z.string(), nodeId: WorkflowNodeIdSchema, phase: z.number() }))
    .readonly(),
});
export type AddWorkflowSubgraphResponse = z.infer<typeof AddWorkflowSubgraphResponseSchema>;
export type AddWorkflowSubgraphError =
  | SubgraphError
  | NodeSpecError
  | WorkflowNotFound
  | WorkflowAlreadyTerminal
  | WorkflowEntityCorruption
  | WorkflowNodeNotFound
  | WorkflowNodeNotMutable
  | WorkflowDagConflict
  | DatabaseUnavailable;
export interface AddWorkflowSubgraphDeps {
  readonly repo: WorkflowRepository;
  readonly coordinator: WorkflowDispatchCoordinator;
  readonly runners: WorkflowRunners;
  readonly now: () => Date;
  readonly randomUUID: () => string;
}
export class AddWorkflowSubgraphUseCase
  implements
    UseCase<AddWorkflowSubgraphRequest, AddWorkflowSubgraphResponse, AddWorkflowSubgraphError>
{
  constructor(private readonly deps: AddWorkflowSubgraphDeps) {}
  execute(
    request: AddWorkflowSubgraphRequest,
  ): UseCaseResult<AddWorkflowSubgraphResponse, AddWorkflowSubgraphError> {
    const parsed = AddWorkflowSubgraphRequestSchema.parse(request);
    return new ResultAsync(
      (async () => {
        const rawNodes: SubgraphTempNodeShape[] = parsed.nodes.map((node) => ({
          tempId: node.tempId,
          kind: node.kind,
          existingParents: node.existingParents ?? [],
        }));
        const rawEdges: SubgraphEdgeShape[] = parsed.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
        }));
        const normalized = normalizeSubgraphInput({ nodes: rawNodes, edges: rawEdges });
        const shape = validateSubgraphShape(parsed.workflowId, normalized.nodes, normalized.edges);
        if (shape.isErr()) return err(shape.error);
        const workflow = await this.deps.repo.get(parsed.workflowId);
        if (workflow.isErr()) return err(workflow.error);
        // Structural check before the (IO-bound) runner.validate loop: every
        // `existingParents` ref must resolve to a node already in this workflow.
        // Mirrors the temp-ref resolution below and keeps runner.validate off
        // the hot path when the subgraph references a node that doesn't exist.
        const existingNodeIds = new Set<string>(workflow.value.nodes.map((node) => node.id));
        for (const node of parsed.nodes) {
          for (const parent of node.existingParents ?? []) {
            if (!existingNodeIds.has(parent))
              return err({
                type: "WorkflowSubgraphInvalid",
                reason: {
                  kind: "nodeRefUnresolved",
                  workflowId: parsed.workflowId,
                  refKind: "existing",
                  refValue: parent,
                },
              });
          }
        }
        const fullByTemp = new Map(parsed.nodes.map((node) => [node.tempId, node]));
        const validatedNodes: SubgraphNodeInput[] = [];
        for (const node of normalized.nodes) {
          const full = fullByTemp.get(node.tempId);
          if (full === undefined)
            return err({
              type: "WorkflowSubgraphInvalid",
              reason: {
                kind: "nodeRefUnresolved",
                workflowId: parsed.workflowId,
                refKind: "temp",
                refValue: node.tempId,
              },
            });
          const specResult = await validateNodeSpec({
            runners: this.deps.runners,
            kind: node.kind,
            spec: full.spec,
            ctx: {
              workflowId: parsed.workflowId,
              workflowStatus: "running",
              coordinatorAgent: workflow.value.coordinatorAgent,
            },
          });
          if (specResult.isErr()) return err(specResult.error);
          const spec =
            node.kind === COORDINATOR_KIND
              ? assertCoordinatorSpecAgent(specResult.value, node.kind)
              : ok(specResult.value);
          if (spec.isErr()) return err(spec.error);
          validatedNodes.push({ ...node, validatedSpec: spec.value });
        }
        const minted = new Map<string, WorkflowNodeId>();
        const added = workflow.value.addSubgraph({
          nodes: validatedNodes,
          edges: normalized.edges,
          mintId: (tempId) => {
            const existing = minted.get(tempId);
            if (existing !== undefined) return existing;
            const next = generateWorkflowNodeId(this.deps.randomUUID);
            minted.set(tempId, next);
            return next;
          },
          nowIso: this.deps.now().toISOString(),
        });
        if (added.isErr()) return err(added.error);
        const saved = await this.deps.repo.save(workflow.value);
        if (saved.isErr()) return err(saved.error);
        this.deps.coordinator.triggerWorkflowTick(parsed.workflowId);
        return ok({ insertedNodes: added.value.insertedNodes });
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
  return runnerFor(args.runners, args.kind)
    .validate(args.spec, args.ctx)
    .mapErr(
      (fault): NodeSpecError => ({
        type: "NodeSpecError",
        nodeKind: args.kind,
        reason: errorReason(fault.cause),
        cause: fault.cause,
      }),
    );
}

function errorReason(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown error";
}
