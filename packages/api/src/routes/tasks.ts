import { stat } from "node:fs/promises";
import path from "node:path";
import type { ActivityItem, TaskId, TaskModule, TaskStatus } from "@glyphs-ai/task";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondTaskError } from "../_error-policies/tasks.js";
import { logEvent } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import {
  DispatchTaskRequestSchema,
  TaskActivityQuerySchema,
  TaskActivityResponseSchema,
  TaskListQuerySchema,
  TaskPathParamsSchema,
  TaskSchema,
} from "../schemas/tasks.js";
import { contentTypeFor, streamFileAsResponse } from "./_task-artifact-stream.js";

const TaskPathSchema = TaskPathParamsSchema.pick({ tid: true });
const ArtifactPathSchema = z.object({ tid: z.string(), name: z.string() });

export function tasksRoutes(resolve: (c: Context) => TaskModule): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["tasks"],
      summary: "List standalone tasks",
      request: { query: TaskListQuerySchema },
      responses: {
        200: jsonResponse(TaskSchema.array(), "Tasks"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const agent = c.req.query("agent");
      const runtime = c.req.query("runtime");
      const createdSince = c.req.query("createdSince");
      const status = c.req.query("status");

      let createdSinceIso: string | undefined;
      if (createdSince !== undefined) {
        const t = Date.parse(createdSince);
        if (Number.isNaN(t)) {
          return c.json({ error: "createdSince must be an ISO 8601 timestamp" }, 400);
        }
        createdSinceIso = new Date(t).toISOString();
      }

      let statuses: TaskStatus[] | undefined;
      if (status !== undefined) {
        const valid = new Set<TaskStatus>(["running", "succeeded", "failed", "cancelled"]);
        const parts = status
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const bad = parts.find((s) => !valid.has(s as TaskStatus));
        if (bad !== undefined) {
          return c.json(
            {
              error: `unknown status: ${JSON.stringify(bad)} (expected running, succeeded, failed, cancelled)`,
            },
            400,
          );
        }
        statuses = parts as TaskStatus[];
      }

      const opts: {
        agent?: string;
        runtime?: string;
        createdSince?: string;
        statuses?: TaskStatus[];
        origin: "standalone";
      } = { origin: "standalone" };
      if (agent !== undefined) opts.agent = agent;
      if (runtime !== undefined) opts.runtime = runtime;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (statuses !== undefined) opts.statuses = statuses;

      const res = await resolve(c).listTasks.execute(opts);
      return res.match(
        (list) => c.json(TaskSchema.array().parse(list)),
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
      request: { body: jsonRequest(DispatchTaskRequestSchema) },
      responses: {
        201: jsonResponse(TaskSchema, "Dispatched task"),
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
          return c.json(TaskSchema.parse(task), 201);
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
        200: jsonResponse(TaskSchema, "Task"),
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
          return c.json(TaskSchema.parse(task));
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
        200: jsonResponse(TaskSchema, "Cancelled task"),
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
          return c.json(TaskSchema.parse(task));
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
      path: "/{tid}/artifact/{name}",
      tags: ["tasks"],
      summary: "Download a task artifact",
      request: { params: ArtifactPathSchema },
      responses: {
        200: errorResponse("Artifact file stream"),
        400: errorResponse("Malformed artifact name"),
        404: errorResponse("Artifact not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const rawName = c.req.param("name");
      if (
        rawName.includes("/") ||
        rawName.includes("\\") ||
        rawName === "." ||
        rawName === ".." ||
        rawName.split("/").includes("..") ||
        rawName.split("\\").includes("..")
      ) {
        return c.json({ error: "artifact name must be a bare filename", code: "BadRequest" }, 400);
      }

      const res = await resolve(c).resolveArtifactPath.execute({ id: id as TaskId, name: rawName });
      if (res.isErr()) {
        return respondTaskError(c, res.error, {
          route: "tasks.artifact",
          meta: { taskId: id, artifact: rawName },
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
      request: { params: TaskPathSchema, query: TaskActivityQuerySchema },
      responses: {
        200: jsonResponse(TaskActivityResponseSchema, "Activity timeline"),
        400: errorResponse("Malformed pagination"),
        404: errorResponse("Task or activity not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const id = c.req.param("tid");
      const beforeRaw = c.req.query("before");
      const afterRaw = c.req.query("after");
      const limitRaw = c.req.query("limit");

      if (beforeRaw !== undefined && afterRaw !== undefined) {
        return c.json(
          { error: "before and after are mutually exclusive", code: "BadRequest" },
          400,
        );
      }

      let before: number | undefined;
      if (beforeRaw !== undefined) {
        const parsed = Number.parseInt(beforeRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || `${parsed}` !== beforeRaw) {
          return c.json(
            { error: "before must be a non-negative integer", code: "BadRequest" },
            400,
          );
        }
        before = parsed;
      }

      let after: number | undefined;
      if (afterRaw !== undefined) {
        const parsed = Number.parseInt(afterRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || `${parsed}` !== afterRaw) {
          return c.json({ error: "after must be a non-negative integer", code: "BadRequest" }, 400);
        }
        after = parsed;
      }

      let limit: number = TASK_ACTIVITY_DEFAULT_LIMIT;
      if (limitRaw !== undefined) {
        const parsed = Number.parseInt(limitRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > TASK_ACTIVITY_MAX_LIMIT) {
          return c.json(
            {
              error: `limit must be an integer in [1, ${TASK_ACTIVITY_MAX_LIMIT}]`,
              code: "BadRequest",
            },
            400,
          );
        }
        limit = parsed;
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

const TASK_ACTIVITY_DEFAULT_LIMIT = 50;
const TASK_ACTIVITY_MAX_LIMIT = 500;
