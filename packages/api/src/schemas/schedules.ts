/**
 * zod schemas for the `/api/workspaces/:id/schedules` wire shapes. Single
 * source of truth for the server's OpenAPI projection and the inferred
 * wire types (re-exported below via `z.infer`), covering the per-kind
 * target DTOs + route request/response shapes, plus the re-exported
 * `Schedule` / `PreviewScheduleResult` domain types from
 * `@glyphs-ai/schedule`.
 */

import { TaskBriefSchema } from "@glyphs-ai/task";
import { WorkflowBriefSchema } from "@glyphs-ai/workflow";
import { z } from "zod";

// ─── Trigger + envelope (schedule domain) ─────────────────────────

export const ScheduleTriggerSchema = z.object({
  kind: z.literal("cron"),
  expr: z.string(),
  tz: z.string(),
});

export const ScheduleTargetEnvelopeSchema = z.object({
  kind: z.string(),
  data: z.unknown(),
});

// ─── Per-kind target DTOs (contracts/schedules.ts) ────────────────

export const TaskTargetDataSchema = z.object({
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  runtime: z.string().optional(),
});

export const TaskTargetPatchSchema = z.object({
  agent: z.string().optional(),
  brief: z.string().optional(),
  details: z.string().nullable().optional(),
  runtime: z.string().nullable().optional(),
});

export const TaskScheduleTargetSchema = TaskTargetDataSchema.extend({
  kind: z.literal("task"),
});

export const WorkflowTargetDataSchema = z.object({
  coordinatorAgent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
});

export const WorkflowTargetPatchSchema = z.object({
  coordinatorAgent: z.string().optional(),
  brief: z.string().optional(),
  details: z.string().nullable().optional(),
});

export const WorkflowScheduleTargetSchema = WorkflowTargetDataSchema.extend({
  kind: z.literal("workflow"),
});

export const ScheduleTargetSchema = z.union([
  TaskScheduleTargetSchema,
  WorkflowScheduleTargetSchema,
  z.object({ kind: z.string(), data: z.unknown() }),
]);

// ─── Schedule entity + response projections ───────────────────────

const scheduleBaseFields = {
  id: z.string(),
  name: z.string(),
  trigger: ScheduleTriggerSchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastFiredAt: z.string().optional(),
  nextFireAt: z.string().optional(),
};

export const ScheduleSchema = z.object({
  ...scheduleBaseFields,
  target: ScheduleTargetEnvelopeSchema,
});

export const ScheduleHeaderSchema = z.object({
  ...scheduleBaseFields,
  target: ScheduleTargetSchema,
  fireStats: z.object({ awaitingCount: z.number(), runningCount: z.number() }).optional(),
});

export const ScheduleGetResponseSchema = z.object({
  ...scheduleBaseFields,
  target: ScheduleTargetSchema,
  describe: z.string(),
});

export const PreviewScheduleResultSchema = z.object({
  describe: z.string(),
  nextRuns: z.array(z.string()),
});

export const ScheduleDeleteResponseSchema = z.object({
  ok: z.literal(true),
  deletedDispatchCount: z.number(),
});

export const ScheduleRunResponseSchema = z.object({
  dispatchId: z.string(),
});

// ─── Request-specific strict schemas (body validation) ────────────

export const ScheduleTriggerRequestSchema = z
  .object({
    kind: z.literal("cron"),
    expr: z.string().refine((s) => s.trim().length > 0, {
      message: "trigger.expr must be a non-empty string",
    }),
    tz: z.string().refine((s) => s.trim().length > 0, {
      message: "trigger.tz must be a non-empty string",
    }),
  })
  .strict();

export const TaskTargetDataRequestSchema = z
  .object({
    agent: z.string().refine((s) => s.trim().length > 0, {
      message: "target.agent must be a non-empty string",
    }),
    brief: TaskBriefSchema,
    details: z.string().optional(),
    runtime: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "target.runtime, when set, must be a non-empty string",
      })
      .optional(),
  })
  .strict();

export const TaskTargetPatchRequestSchema = z
  .object({
    agent: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "target.agent must be a non-empty string",
      })
      .optional(),
    brief: TaskBriefSchema.optional(),
    details: z.string().nullable().optional(),
    runtime: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "target.runtime, when set, must be a non-empty string",
      })
      .nullable()
      .optional(),
  })
  .strict();

export const WorkflowTargetDataRequestSchema = z
  .object({
    coordinatorAgent: z.string().refine((s) => s.trim().length > 0, {
      message: "target.coordinatorAgent must be a non-empty string",
    }),
    brief: WorkflowBriefSchema,
    details: z.string().optional(),
  })
  .strict();

export const WorkflowTargetPatchRequestSchema = z
  .object({
    coordinatorAgent: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "target.coordinatorAgent must be a non-empty string",
      })
      .optional(),
    brief: WorkflowBriefSchema.optional(),
    details: z.string().nullable().optional(),
  })
  .strict();

// ─── Query / request / path-param DTOs (routes/schedules.ts) ──────

export const ScheduleListQuerySchema = z.object({
  agent: z.string().optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

export const SchedulePreviewQuerySchema = z.object({
  n: z.string().optional(),
});

export const SchedulePreviewCronQuerySchema = z.object({
  expr: z.string(),
  tz: z.string(),
  n: z.string().optional(),
});

export const SchedulePathParamsSchema = z.object({
  id: z.string(),
  sid: z.string(),
});

export const CreateTaskScheduleRequestSchema = z
  .object({
    name: z.string().refine((s) => s.trim().length > 0, {
      message: "name must be a non-empty string",
    }),
    target: TaskTargetDataRequestSchema,
    trigger: ScheduleTriggerRequestSchema,
    enabled: z.boolean().optional(),
  })
  .strict();

export const PatchTaskScheduleRequestSchema = z
  .object({
    name: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "name must be a non-empty string",
      })
      .optional(),
    target: TaskTargetPatchRequestSchema.optional(),
    trigger: ScheduleTriggerRequestSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const CreateWorkflowScheduleRequestSchema = z
  .object({
    name: z.string().refine((s) => s.trim().length > 0, {
      message: "name must be a non-empty string",
    }),
    target: WorkflowTargetDataRequestSchema,
    trigger: ScheduleTriggerRequestSchema,
    enabled: z.boolean().optional(),
  })
  .strict();

export const PatchWorkflowScheduleRequestSchema = z
  .object({
    name: z
      .string()
      .refine((s) => s.trim().length > 0, {
        message: "name must be a non-empty string",
      })
      .optional(),
    target: WorkflowTargetPatchRequestSchema.optional(),
    trigger: ScheduleTriggerRequestSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// Inferred wire types — single source of truth is the schemas above.
export type ScheduleListQuery = z.infer<typeof ScheduleListQuerySchema>;
export type CreateTaskScheduleRequest = z.infer<typeof CreateTaskScheduleRequestSchema>;
export type PatchTaskScheduleRequest = z.infer<typeof PatchTaskScheduleRequestSchema>;
export type CreateWorkflowScheduleRequest = z.infer<typeof CreateWorkflowScheduleRequestSchema>;
export type PatchWorkflowScheduleRequest = z.infer<typeof PatchWorkflowScheduleRequestSchema>;
export type SchedulePathParams = z.infer<typeof SchedulePathParamsSchema>;
export type ScheduleGetResponse = z.infer<typeof ScheduleGetResponseSchema>;
export type ScheduleHeader = z.infer<typeof ScheduleHeaderSchema>;
export type SchedulePreviewQuery = z.infer<typeof SchedulePreviewQuerySchema>;
export type SchedulePreviewCronQuery = z.infer<typeof SchedulePreviewCronQuerySchema>;
export type ScheduleDeleteResponse = z.infer<typeof ScheduleDeleteResponseSchema>;
export type ScheduleRunResponse = z.infer<typeof ScheduleRunResponseSchema>;
