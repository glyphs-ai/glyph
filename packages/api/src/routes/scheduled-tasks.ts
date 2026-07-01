import type { TaskModule, TaskStatus } from "@glyphs-ai/task";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondTaskError } from "../_error-policies/tasks.js";
import { createApiApp, errorResponse, jsonResponse } from "../_http-helpers.js";
import { ScheduledTaskListQuerySchema, TaskSchema } from "../schemas/tasks.js";

export function scheduledTasksRoutes(resolve: (c: Context) => TaskModule): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["scheduled-tasks"],
      summary: "List schedule-launched tasks",
      request: { query: ScheduledTaskListQuerySchema },
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
      const scheduleId = c.req.query("scheduleId");

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
        origin: "schedule";
        originId?: string;
      } = { origin: "schedule" };
      if (agent !== undefined) opts.agent = agent;
      if (runtime !== undefined) opts.runtime = runtime;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (statuses !== undefined) opts.statuses = statuses;
      if (scheduleId !== undefined) opts.originId = scheduleId;

      const res = await resolve(c).listTasks.execute(opts);
      return res.match(
        (list) => c.json(TaskSchema.array().parse(list)),
        (err) => respondTaskError(c, err, { route: "scheduled-tasks.list" }),
      );
    },
  );

  return app;
}
