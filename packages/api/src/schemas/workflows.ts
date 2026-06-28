/**
 * zod schemas for the `/api/workspaces/:id/workflows` +
 * `/scheduled-workflows` wire shapes. Single source of truth for the
 * server's OpenAPI projection and the inferred wire types (re-exported
 * below via `z.infer`), plus the re-exported workflow domain enums /
 * terminal payloads from `@glyphs-ai/workflow`.
 */
import { z } from "zod";

// ─── Domain enums (workflow substrate) ────────────────────────────

export const WorkflowStatusSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);

// `origin` is route-closed and never inbound: the server hard-codes it
// per route ("standalone" by default; "schedule" synthesized in the
// schedule wiring), so this schema is not request validation — it is
// the OpenAPI enumerated-values catalog plus the client-side response
// type. Keep it an explicit enum even though the workflow substrate
// stores `origin` as an open `string`; a future integration adds one
// member here and one route, with no substrate change.
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
  originId: z.string().optional(),
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

export const CreateWorkflowRequestSchema = z
  .object({
    brief: z.string().refine((s) => s.trim().length > 0, {
      message: "brief must be a non-empty string",
    }),
    details: z.string().optional(),
    coordinatorAgent: z.string().refine((s) => s.trim().length > 0, {
      message: "coordinatorAgent must be a non-empty string",
    }),
  })
  .strict();

export const AddNodeRequestSchema = z
  .object({
    kind: WorkflowNodeKindSchema,
    spec: z.unknown().refine((v) => v !== undefined, { message: "spec is required" }),
    parents: z.array(z.string().min(1, { message: "parents entries must be non-empty strings" })),
  })
  .strict();

export const AddNodeResponseSchema = z.object({
  nodeId: z.string(),
  phase: z.number(),
});

export const AddEdgeRequestSchema = z
  .object({
    fromNodeId: z.string().min(1, { message: "fromNodeId must be a non-empty string" }),
    toNodeId: z.string().min(1, { message: "toNodeId must be a non-empty string" }),
  })
  .strict();

export const AddEdgeResponseSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  toPhase: z.number(),
});

export const WorkflowNodeRefSchema = z.union([
  z
    .object({
      nodeId: z.string().min(1, { message: "ref.nodeId must be a non-empty string" }),
    })
    .strict(),
  z
    .object({
      tempId: z.string().min(1, { message: "ref.tempId must be a non-empty string" }),
    })
    .strict(),
]);

export const AddSubgraphRequestNodeSchema = z
  .object({
    tempId: z.string().min(1, { message: "tempId must be a non-empty string" }),
    kind: WorkflowNodeKindSchema,
    spec: z.unknown().refine((v) => v !== undefined, { message: "spec is required" }),
    existingParents: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const AddSubgraphRequestEdgeSchema = z
  .object({
    from: WorkflowNodeRefSchema,
    to: WorkflowNodeRefSchema,
  })
  .strict();

export const AddSubgraphRequestSchema = z
  .object({
    nodes: z.array(AddSubgraphRequestNodeSchema),
    edges: z.array(AddSubgraphRequestEdgeSchema),
  })
  .strict();

export const AddSubgraphResponseInsertedNodeSchema = z.object({
  tempId: z.string(),
  nodeId: z.string(),
  phase: z.number(),
});

export const AddSubgraphResponseSchema = z.object({
  insertedNodes: z.array(AddSubgraphResponseInsertedNodeSchema),
});

export const ReplaceNodeSpecRequestSchema = z
  .object({
    newSpec: z.unknown().refine((v) => v !== undefined, { message: "newSpec is required" }),
  })
  .strict();

export const FinishWorkflowRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("succeeded"),
      success: z.object({ output: z.string().nullable().optional() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("failed"),
      failure: z
        .object({
          kind: z.literal("coordinator").default("coordinator"),
          message: z.string(),
        })
        .strict(),
    })
    .strict(),
]);

export const CancelWorkflowRequestSchema = z
  .object({
    cancellation: z
      .object({
        kind: z.literal("user").default("user"),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export const RespondHumanNodeRequestSchema = z
  .object({
    choiceId: z
      .string()
      .min(1, { message: "choiceId, when set, must be a non-empty string" })
      .optional(),
    input: z.string().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.choiceId === undefined &&
      (typeof data.input !== "string" || data.input.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input"],
        message: "input is required when choiceId is absent",
      });
    }
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

// Inferred wire types — single source of truth is the schemas above.
export type WorkflowDeleteQuery = z.infer<typeof WorkflowDeleteQuerySchema>;
export type WorkflowPathParams = z.infer<typeof WorkflowPathParamsSchema>;
export type WorkflowNodePathParams = z.infer<typeof WorkflowNodePathParamsSchema>;
export type WorkflowEdgePathParams = z.infer<typeof WorkflowEdgePathParamsSchema>;
export type WorkflowArtifactPathParams = z.infer<typeof WorkflowArtifactPathParamsSchema>;
