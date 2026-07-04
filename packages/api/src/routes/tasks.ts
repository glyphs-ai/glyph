import { stat } from "node:fs/promises";
import path from "node:path";
import {
  type ActivityItem,
  type ActivityResult,
  CancelTaskResponseSchema,
  DispatchTaskResponseSchema,
  GetTaskActivityRequestSchema,
  GetTaskResponseSchema,
  ListTasksRequestSchema,
  ListTasksResponseSchema,
  DispatchTaskRequestSchema as TaskDispatchRequestSchema,
  type TaskId,
  type TaskModule,
  type TaskStatus,
} from "@glyphs-ai/task";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondTaskError } from "../_error-policies/tasks.js";
import { logEvent } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import { contentTypeFor, streamFileAsResponse } from "./_artifact-stream.js";

const TaskPathSchema = z.object({ tid: z.string() });
const ArtifactQuerySchema = z.object({ path: z.string().min(1) });

// ─── ActivityItem timeline — api-owned zod for the OpenAPI projection ─────
// (the runtime exposes `ActivityItem` / `ActivityResult` as TS types only.)

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

const ActivityItemSchema = z.discriminatedUnion("kind", [
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

const TruncationInfoSchema = z.object({
  reason: z.enum(["size_limit", "page_limit"]),
  droppedBytes: z.number().optional(),
  droppedItems: z.number().optional(),
  hint: z.string().optional(),
});

/** Response body of `GET /api/workspaces/:id/tasks/:tid/activity`. */
const TaskActivityResponseSchema = z.object({
  activity: z.array(ActivityItemSchema),
  result: z.string().nullable(),
  totalItems: z.number(),
  truncated: TruncationInfoSchema.optional(),
});

/**
 * Compile-time drift guard. Activity is a runtime-produced shape (not a
 * task-domain response), so `TaskActivityResponseSchema` is an api-owned
 * hand-mirror of runtime's `ActivityResult`. This declaration stops compiling
 * if the two drift — update the schema when the runtime activity vocabulary
 * changes. `Writable` strips runtime's `readonly` so the check compares shape,
 * not mutability.
 */
type Writable<T> = T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T;
const _activityWireMatchesRuntime: Writable<ActivityResult> extends z.infer<
  typeof TaskActivityResponseSchema
>
  ? true
  : never = true;

export function tasksRoutes(resolve: (c: Context) => TaskModule): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["tasks"],
      summary: "List standalone tasks",
      // Query reuses the task read-model's list contract, dropping only the
      // server-owned `origin` / `originId` scoping (this route is
      // standalone-only) and staying lenient about unknown params (`.strip()`).
      // `status` is the shared `TaskStatus` enum — an invalid value is rejected
      // at the boundary.
      request: {
        query: ListTasksRequestSchema.omit({ origin: true, originId: true }).strip(),
      },
      responses: {
        200: jsonResponse(ListTasksResponseSchema, "Tasks"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const { agent, runtime, createdSince, status } = c.req.valid("query");

      let createdSinceIso: string | undefined;
      if (createdSince !== undefined) {
        const t = Date.parse(createdSince);
        if (Number.isNaN(t)) {
          return c.json({ error: "createdSince must be an ISO 8601 timestamp" }, 400);
        }
        createdSinceIso = new Date(t).toISOString();
      }

      const opts: {
        agent?: string;
        runtime?: string;
        createdSince?: string;
        status?: TaskStatus;
        origin: "standalone";
      } = { origin: "standalone" };
      if (agent !== undefined) opts.agent = agent;
      if (runtime !== undefined) opts.runtime = runtime;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (status !== undefined) opts.status = status;

      const res = await resolve(c).listTasks.execute(opts);
      return res.match(
        (list) => c.json(list),
        (err) => respondTaskError(c, err, { route: "tasks.list" }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["tasks"],
      summary: "Dispatch a task",
      // Untrusted HTTP dispatch body: the task package's canonical dispatch
      // contract narrowed to the four client-settable fields. `origin` /
      // `originId` / `metadata` / `subprocessEnv` / `prompt` are server-owned
      // and rejected by `.strict()`; `brief` inherits the shared
      // `TaskBriefSchema` invariant. The route fills `origin` before calling
      // the use-case.
      request: {
        body: jsonRequest(
          TaskDispatchRequestSchema.pick({
            agent: true,
            brief: true,
            details: true,
            runtime: true,
          }).strict(),
        ),
      },
      responses: {
        201: jsonResponse(DispatchTaskResponseSchema, "Dispatched task"),
        400: errorResponse("Malformed request body"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const res = await resolve(c).dispatchTask.execute({
        agent: body.agent,
        brief: body.brief,
        ...(body.details !== undefined ? { details: body.details } : {}),
        ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
      });
      return res.match(
        (task) => {
          logEvent(c, "task dispatched", {
            taskId: task.id,
            agent: task.agent,
            runtime: task.metadata?.runtime,
          });
          return c.json(task, 201);
        },
        (err) => respondTaskError(c, err, { route: "tasks" }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{tid}",
      tags: ["tasks"],
      summary: "Get a task",
      request: { params: TaskPathSchema },
      responses: {
        200: jsonResponse(GetTaskResponseSchema, "Task"),
        404: errorResponse("Task not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const res = await resolve(c).getTask.execute({ id: id as TaskId });
      return res.match(
        (task) => {
          if (task === null) return c.json({ error: "not found", code: "TaskNotFound" }, 404);
          return c.json(task);
        },
        (err) => respondTaskError(c, err, { route: "tasks.get", meta: { taskId: id } }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{tid}",
      tags: ["tasks"],
      summary: "Delete a task",
      request: {
        params: TaskPathSchema,
        query: z.object({ purge: z.string().optional() }),
      },
      responses: {
        204: errorResponse("Deleted (no content)"),
        404: errorResponse("Task not found"),
        409: errorResponse("Task is not terminal"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const purge = c.req.query("purge") === "1";
      const res = await resolve(c).deleteTask.execute({ id: id as TaskId, purge });
      return res.match(
        () => {
          logEvent(c, "task deleted", { taskId: id, purge });
          return c.body(null, 204);
        },
        (err) =>
          respondTaskError(c, err, {
            route: "tasks.delete",
            transition: "delete",
            meta: { taskId: id, purge },
          }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{tid}/cancel",
      tags: ["tasks"],
      summary: "Cancel a running task",
      request: { params: TaskPathSchema },
      responses: {
        200: jsonResponse(CancelTaskResponseSchema, "Cancelled task"),
        404: errorResponse("Task not found"),
        409: errorResponse("Task already terminal"),
        503: errorResponse("Server shutting down"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const res = await resolve(c).cancelTask.execute({ id: id as TaskId });
      return res.match(
        (task) => {
          logEvent(c, "task cancelled", { taskId: id });
          return c.json(task);
        },
        (err) =>
          respondTaskError(c, err, {
            route: "tasks.cancel",
            transition: "cancel",
            meta: { taskId: id },
          }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{tid}/artifact",
      tags: ["tasks"],
      summary: "Download a task artifact",
      request: { params: TaskPathSchema, query: ArtifactQuerySchema },
      responses: {
        200: errorResponse("Artifact file stream"),
        400: errorResponse("Malformed artifact name"),
        404: errorResponse("Artifact not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      // The artifact's relative-path identity rides as `?path=`, not a path
      // segment, because it is slash-bearing and of arbitrary depth — which a
      // single `{name}` segment can't carry (mirrors the catalog files route).
      const relPath = c.req.query("path") ?? "";
      if (
        relPath === "" ||
        relPath.startsWith("/") ||
        relPath.includes("\\") ||
        relPath.split("/").includes("..")
      ) {
        return c.json({ error: "artifact path must be a relative path", code: "BadRequest" }, 400);
      }

      const res = await resolve(c).resolveArtifactPath.execute({ id: id as TaskId, relPath });
      if (res.isErr()) {
        return respondTaskError(c, res.error, {
          route: "tasks.artifact",
          meta: { taskId: id, artifact: relPath },
        });
      }
      const absPath = res.value;
      if (absPath === null) {
        return c.json({ error: "artifact not found", code: "NotFound" }, 404);
      }
      try {
        const st = await stat(absPath);
        if (!st.isFile()) {
          return c.json({ error: "artifact not found", code: "NotFound" }, 404);
        }
      } catch {
        return c.json({ error: "artifact not found", code: "NotFound" }, 404);
      }

      return streamFileAsResponse(absPath, {
        contentType: contentTypeFor(path.basename(absPath)),
        cacheControl: "private, max-age=60",
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{tid}/activity",
      tags: ["tasks"],
      summary: "Get a task's activity timeline",
      // Query reuses the task read-model's canonical activity contract,
      // dropping only `id` (carried by the `{tid}` path param). Coercion,
      // numeric bounds, and the default page size live once in
      // `GetTaskActivityRequestSchema`; `.strip()` keeps unknown query params
      // lenient (ignored, not a 400).
      request: {
        params: TaskPathSchema,
        query: GetTaskActivityRequestSchema.omit({ id: true }).strip(),
      },
      responses: {
        200: jsonResponse(TaskActivityResponseSchema, "Activity timeline"),
        400: errorResponse("Malformed pagination"),
        404: errorResponse("Task or activity not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const { before, after, limit } = c.req.valid("query");

      // before/after are opposite pagination directions — reject the
      // contradiction early with a friendly 400 rather than forwarding both
      // to the runtime. (Malformed/out-of-range values are already rejected
      // upstream by the shared query schema as a ValidationError.)
      if (before !== undefined && after !== undefined) {
        return c.json(
          { error: "before and after are mutually exclusive", code: "BadRequest" },
          400,
        );
      }

      const res = await resolve(c).getTaskActivity.execute({
        id: id as TaskId,
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
        limit,
      });
      return res.match(
        (payload) => {
          if (payload === null) {
            return c.json(
              { error: "no activity is available for this task", code: "NoEventsYet" },
              404,
            );
          }
          return c.json(TaskActivityResponseSchema.parse(payload));
        },
        (err) => respondTaskError(c, err, { route: "tasks.activity", meta: { taskId: id } }),
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{tid}/activity/stream",
      tags: ["tasks"],
      summary: "Stream a task's activity (SSE)",
      request: { params: TaskPathSchema },
      responses: {
        200: errorResponse("SSE stream (text/event-stream)"),
        404: errorResponse("Task or stream not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const lastEventId = c.req.header("Last-Event-ID");
      const after =
        lastEventId !== undefined && /^\d+$/.test(lastEventId)
          ? Number.parseInt(lastEventId, 10)
          : undefined;
      const res = await resolve(c).getTaskActivityStream.execute({
        id: id as TaskId,
        ...(after !== undefined ? { after } : {}),
        signal: c.req.raw.signal,
      });
      if (res.isErr()) {
        return respondTaskError(c, res.error, {
          route: "tasks.activity.stream",
          meta: { taskId: id },
        });
      }
      const stream = res.value;
      if (stream === null) {
        return c.json(
          { error: "no streaming activity available for this task", code: "NoEventsYet" },
          404,
        );
      }

      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueue = (frame: string) => {
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              // Controller closed (client gone).
            }
          };
          try {
            for await (const item of stream as AsyncIterable<ActivityItem>) {
              if (c.req.raw.signal.aborted) break;
              enqueue(`event: activity\nid: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`);
            }
            enqueue("event: end\ndata: {}\n\n");
          } catch (err) {
            enqueue(
              `event: error\ndata: ${JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              })}\n\n`,
            );
          } finally {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );

  return app;
}
