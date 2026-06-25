/**
 * zod schemas for the `/api/workspaces/:id/workflows` +
 * `/scheduled-workflows` wire shapes. Mirrors the DTOs in
 * `@glyphs-ai/contracts` (`workflows.ts` + `routes/workflows.ts`) plus
 * the re-exported workflow domain enums / terminal payloads from
 * `@glyphs-ai/workflow`; parity pinned by the wire-schema parity test.
 */
import { z } from "zod";

// ─── Domain enums (workflow substrate) ────────────────────────────

export const WorkflowStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);

export const WorkflowOriginSchema = z.enum(["standalone", "schedule"]);

export const WorkflowNodeStatusSchema = z.enum([
  "not_started",
  "ready",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const WorkflowNodeKindSchema = z.enum(["coordinator", "worker", "human"]);

// ─── Terminal payloads ────────────────────────────────────────────

export const WorkflowSuccessSchema = z.object({
  output: z.string().nullable(),
});

export const WorkflowFailureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinator"), message: z.string() }),
  z.object({
    kind: z.literal("substrate"),
    reason: z.literal("STUCK_RETRY_LIMIT"),
    message: z.string(),
  }),
]);

export const WorkflowCancellationSchema = z.object({
  kind: z.literal("user"),
  message: z.string(),
});

// ─── Node spec (per-kind, flat projection) ────────────────────────

export const WorkflowWorkerNodeSpecSchema = z.object({
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  runtime: z.string().optional(),
});

export const WorkflowCoordinatorNodeSpecSchema = z.object({
  agent: z.string(),
});

export const WorkflowHumanNodeSpecSchema = z.object({
  kind: z.literal("human"),
  prompt: z.string(),
  promptStyle: z.enum(["plain", "markdown"]),
  choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});

// Plain union (not discriminated): the trailing `{ kind: string }` arm
// overlaps every literal-kind arm, so a discriminator key cannot be
// pinned to a closed set.
export const WorkflowNodeSpecSchema = z.union([
  WorkflowWorkerNodeSpecSchema.extend({ kind: z.literal("worker") }),
  WorkflowCoordinatorNodeSpecSchema.extend({ kind: z.literal("coordinator") }),
  WorkflowHumanNodeSpecSchema,
  z.object({ kind: z.string(), spec: z.unknown() }),
]);

// ─── Header / node / edge / dag projections ───────────────────────

export const WorkflowHeaderSchema = z.object({
  id: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  coordinatorAgent: z.string(),
  status: WorkflowStatusSchema,
  origin: WorkflowOriginSchema,
  metadata: z.record(z.string(), z.unknown()),
  iterationCount: z.number().optional(),
  awaitingHumanCount: z.number(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  success: WorkflowSuccessSchema.optional(),
  failure: WorkflowFailureSchema.optional(),
  cancellation: WorkflowCancellationSchema.optional(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  phase: z.number(),
  status: WorkflowNodeStatusSchema,
  taskId: z.string().optional(),
  spec: WorkflowNodeSpecSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readyAt: z.string().optional(),
  runningAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const WorkflowDagSchema = z.object({
  workflow: WorkflowHeaderSchema,
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
});

// ─── Mutation request / response DTOs ─────────────────────────────

export const CreateWorkflowRequestSchema = z.object({
  brief: z.string(),
  details: z.string().optional(),
  coordinatorAgent: z.string(),
});

export const AddNodeRequestSchema = z.object({
  kind: WorkflowNodeKindSchema,
  spec: z.unknown(),
  parents: z.array(z.string()),
});

export const AddNodeResponseSchema = z.object({
  nodeId: z.string(),
  phase: z.number(),
});

export const AddEdgeRequestSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
});

export const AddEdgeResponseSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  toPhase: z.number(),
});

export const WorkflowNodeRefSchema = z.union([
  z.object({ nodeId: z.string() }),
  z.object({ tempId: z.string() }),
]);

export const AddSubgraphRequestNodeSchema = z.object({
  tempId: z.string(),
  kind: WorkflowNodeKindSchema,
  spec: z.unknown(),
  existingParents: z.array(z.string()).optional(),
});

export const AddSubgraphRequestEdgeSchema = z.object({
  from: WorkflowNodeRefSchema,
  to: WorkflowNodeRefSchema,
});

export const AddSubgraphRequestSchema = z.object({
  nodes: z.array(AddSubgraphRequestNodeSchema),
  edges: z.array(AddSubgraphRequestEdgeSchema),
});

export const AddSubgraphResponseInsertedNodeSchema = z.object({
  tempId: z.string(),
  nodeId: z.string(),
  phase: z.number(),
});

export const AddSubgraphResponseSchema = z.object({
  insertedNodes: z.array(AddSubgraphResponseInsertedNodeSchema),
});

export const ReplaceNodeSpecRequestSchema = z.object({
  newSpec: z.unknown(),
});

export const FinishWorkflowRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("succeeded"),
    success: z.object({ output: z.string().nullable().optional() }).optional(),
  }),
  z.object({
    kind: z.literal("failed"),
    failure: z.object({ kind: z.literal("coordinator"), message: z.string() }),
  }),
]);

export const CancelWorkflowRequestSchema = z.object({
  cancellation: z.object({ kind: z.literal("user"), message: z.string() }),
});

export const RespondHumanNodeRequestSchema = z.object({
  choiceId: z.string().optional(),
  input: z.string().optional(),
});

// ─── Artifacts ────────────────────────────────────────────────────

export const WorkflowArtifactMimeBucketSchema = z.enum(["text", "image", "archive", "generic"]);

export const WorkflowArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workflow-summary"),
    path: z.string(),
    size: z.number(),
    modifiedAt: z.string(),
    mimeBucket: WorkflowArtifactMimeBucketSchema,
  }),
  z.object({
    kind: z.literal("node"),
    nodeId: z.string(),
    taskId: z.string(),
    path: z.string(),
    size: z.number(),
    modifiedAt: z.string(),
    mimeBucket: WorkflowArtifactMimeBucketSchema,
  }),
]);

export const WorkflowArtifactsResponseSchema = z.object({
  artifacts: z.array(WorkflowArtifactSchema),
});

// ─── Query / path-param DTOs (routes/workflows.ts) ────────────────

export const WorkflowListQuerySchema = z.object({
  q: z.string().optional(),
  coordinatorAgent: z.string().optional(),
  createdSince: z.string().optional(),
});

export const WorkflowDeleteQuerySchema = z.object({
  purge: z.literal("1").optional(),
});

export const WorkflowPathParamsSchema = z.object({
  id: z.string(),
  wfid: z.string(),
});

export const WorkflowNodePathParamsSchema = z.object({
  id: z.string(),
  wfid: z.string(),
  nid: z.string(),
});

export const WorkflowEdgePathParamsSchema = z.object({
  id: z.string(),
  wfid: z.string(),
  from: z.string(),
  to: z.string(),
});

export const WorkflowArtifactPathParamsSchema = z.object({
  id: z.string(),
  wfid: z.string(),
  encodedPath: z.string(),
});
