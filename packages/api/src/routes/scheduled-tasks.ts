import {
  ListTasksRequestSchema,
  ListTasksResponseSchema,
  type TaskModule,
  type TaskStatus,
} from "@glyphs-ai/task";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondTaskError } from "../_error-policies/tasks.js";
import { createApiApp, errorResponse, jsonResponse } from "../_http-helpers.js";

export function scheduledTasksRoutes(resolve: (c: Context) => TaskModule): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["scheduled-tasks"],
      summary: "List schedule-launched tasks",
      // Query reuses the task read-model's list contract, dropping the
      // server-owned `origin` scoping (pinned to "schedule") and re-mapping its
      // `originId` to the `scheduleId` wire param. Unknown params stay lenient
      // (`.strip()`).
      request: {
        query: ListTasksRequestSchema.omit({ origin: true, originId: true })
          .extend({ scheduleId: z.string().optional() })
          .strip(),
      },
      responses: {
        200: jsonResponse(ListTasksResponseSchema, "Tasks"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const { agent, runtime, createdSince, status, scheduleId } = c.req.valid("query");

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
        origin: "schedule";
        originId?: string;
      } = { origin: "schedule" };
      if (agent !== undefined) opts.agent = agent;
      if (runtime !== undefined) opts.runtime = runtime;
      if (createdSinceIso !== undefined) opts.createdSince = createdSinceIso;
      if (status !== undefined) opts.status = status;
      if (scheduleId !== undefined) opts.originId = scheduleId;

      const res = await resolve(c).listTasks.execute(opts);
      return res.match(
        (list) => c.json(list),
        (err) => respondTaskError(c, err, { route: "scheduled-tasks.list" }),
      );
    },
  );

  return app;
}
