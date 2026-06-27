/**
 * zod schemas for the `/api/workspaces/:id/tasks` + `/scheduled-tasks`
 * wire shapes. Mirrors the DTOs in `@glyphs-ai/contracts`
 * (`routes/tasks.ts`) plus the re-exported `Task` domain type and the
 * `ActivityItem` / `TruncationInfo` runtime types; parity pinned by the
 * wire-schema parity test.
 */
import { z } from "zod";

// ─── Task entity + terminal payloads ──────────────────────────────

const TaskSuccessSchema = z.object({
  output: z.string().nullable(),
  artifacts: z.array(z.string()).optional(),
});

// `TaskFailure`'s two `execution` arms share the `kind` discriminator,
// so this is a plain union (not a discriminated union). `signal` is a
// `NodeJS.Signals` literal union we don't reproduce — `z.custom` keeps
// the inferred type exact for parity without runtime validation (wire
// responses are not validated). The `.meta({ type: "string" })` is
// native zod metadata that lets the OpenAPI projection render `signal`
// as a string (the converter can't otherwise map a `z.custom` schema).
const TaskFailureSchema = z.union([
  z.object({
    kind: z.literal("execution"),
    exitCode: z.number(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("execution"),
    signal: z.custom<NodeJS.Signals>().meta({ type: "string" }),
    message: z.string(),
  }),
  z.object({ kind: z.literal("internal"), message: z.string() }),
  z.object({ kind: z.literal("cascade"), message: z.string() }),
]);

const TaskCancellationSchema = z.union([
  z.object({ kind: z.literal("user"), message: z.string() }),
  z.object({ kind: z.literal("cascade"), message: z.string() }),
]);

export const TaskSchema = z.object({
  id: z.string(),
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  origin: z.enum(["standalone", "workflow", "schedule"]),
  originId: z.string().optional(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  success: TaskSuccessSchema.optional(),
  failure: TaskFailureSchema.optional(),
  cancellation: TaskCancellationSchema.optional(),
});

// ─── ActivityItem (runtime-neutral timeline) ──────────────────────

const TokenUsageSchema = z.object({
  input: z.number().optional(),
  output: z.number(),
  cached: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
  total: z.number().optional(),
});

const SummaryStatsSchema = z.object({
  filesModified: z.array(z.string()).optional(),
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
  toolCallsCount: z.number().optional(),
  durationMs: z.number().optional(),
  costUSD: z.number().optional(),
  model: z.string().optional(),
  premiumRequests: z.number().optional(),
});

const AttachmentSchema = z.object({
  kind: z.enum(["image", "file"]),
  mimeType: z.string().optional(),
  url: z.string().optional(),
  data: z.string().optional(),
  name: z.string().optional(),
});

const activityBase = {
  seq: z.number(),
  id: z.string().optional(),
  parentSeq: z.number().optional(),
  timestamp: z.string(),
};

export const ActivityItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...activityBase,
    kind: z.literal("user"),
    text: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
  }),
  z.object({
    ...activityBase,
    kind: z.literal("assistant"),
    text: z.string(),
    model: z.string().optional(),
    tokens: TokenUsageSchema.optional(),
    stopReason: z.string().optional(),
  }),
  z.object({
    ...activityBase,
    kind: z.literal("thinking"),
    text: z.string(),
    subject: z.string().optional(),
  }),
  z.object({
    ...activityBase,
    kind: z.literal("tool_call"),
    callId: z.string(),
    name: z.string(),
    args: z.unknown().optional(),
    status: z.enum(["running", "success", "error", "cancelled"]),
    result: z.unknown().optional(),
    display: z.object({ content: z.string(), markdown: z.boolean().optional() }).optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    ...activityBase,
    kind: z.literal("system"),
    text: z.string(),
    level: z.enum(["info", "warn", "error"]).optional(),
    subKind: z.string().optional(),
  }),
  z.object({
    ...activityBase,
    kind: z.literal("summary"),
    text: z.string().optional(),
    tokens: TokenUsageSchema.optional(),
    stats: SummaryStatsSchema.optional(),
  }),
]);

export const TruncationInfoSchema = z.object({
  reason: z.enum(["size_limit", "page_limit"]),
  droppedBytes: z.number().optional(),
  droppedItems: z.number().optional(),
  hint: z.string().optional(),
});

/** Response body of `GET /api/workspaces/:id/tasks/:tid/activity`. */
export const TaskActivityResponseSchema = z.object({
  activity: z.array(ActivityItemSchema),
  result: z.string().nullable(),
  totalItems: z.number(),
  truncated: TruncationInfoSchema.optional(),
});

// ─── Query / request / path-param DTOs ────────────────────────────

export const TaskListQuerySchema = z.object({
  agent: z.string().optional(),
  runtime: z.string().optional(),
  createdSince: z.string().optional(),
  status: z.string().optional(),
});

export const ScheduledTaskListQuerySchema = z.object({
  agent: z.string().optional(),
  runtime: z.string().optional(),
  createdSince: z.string().optional(),
  status: z.string().optional(),
  scheduleId: z.string().optional(),
});

export const DispatchTaskRequestSchema = z.object({
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  runtime: z.string().optional(),
});

export const TaskDeleteQuerySchema = z.object({
  purge: z.literal("1").optional(),
});

export const TaskActivityQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.string().optional(),
});

export const TaskPathParamsSchema = z.object({
  id: z.string(),
  tid: z.string(),
});
