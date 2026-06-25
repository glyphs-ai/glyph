/**
 * zod schemas for the `/api/workspaces/:id/schedules` wire shapes.
 * Mirrors the per-kind target DTOs + route request/response shapes in
 * `@glyphs-ai/contracts` (`schedules.ts` + `routes/schedules.ts`) plus
 * the re-exported `Schedule` / `PreviewScheduleResult` domain types
 * from `@glyphs-ai/schedule`; parity pinned by the wire-schema parity
 * test.
 */
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

export const CreateTaskScheduleRequestSchema = z.object({
  name: z.string(),
  target: TaskTargetDataSchema,
  trigger: ScheduleTriggerSchema,
  enabled: z.boolean().optional(),
});

export const PatchTaskScheduleRequestSchema = z.object({
  name: z.string().optional(),
  target: TaskTargetPatchSchema.optional(),
  trigger: ScheduleTriggerSchema.optional(),
  enabled: z.boolean().optional(),
});

export const CreateWorkflowScheduleRequestSchema = z.object({
  name: z.string(),
  target: WorkflowTargetDataSchema,
  trigger: ScheduleTriggerSchema,
  enabled: z.boolean().optional(),
});

export const PatchWorkflowScheduleRequestSchema = z.object({
  name: z.string().optional(),
  target: WorkflowTargetPatchSchema.optional(),
  trigger: ScheduleTriggerSchema.optional(),
  enabled: z.boolean().optional(),
});
