/**
 * Routes for `/api/workspaces/:id/schedules/task` — task-kind schedule CRUD +
 * run + preview. The kind is fixed by the mount path; every id-scoped op passes
 * `expectedKind: "task"` so a workflow-kind row under the same id reads as
 * absent (404), and the wire never leaks the other kind.
 *
 * The `@glyphs-ai/schedule` substrate is kind-agnostic and stores the target
 * opaquely as `{ kind, data: unknown }`. This module owns the CONCRETE
 * task-target wire shape (`{ agent, brief, details?, runtime? }`): validated on
 * write, projected flat on read. There is no cross-kind union here — the
 * workflow surface is a separate module (`routes/schedules/scheduled-workflows.ts`).
 *
 * ## Endpoints (mounted under `/schedules/task`)
 *
 *   - `GET    /`             — list task schedules; `?agent=`, `?enabled=`
 *   - `POST   /`             — create a task schedule
 *   - `GET    /:sid`         — get one (enriched with derived `describe`)
 *   - `PATCH  /:sid`         — RFC 7396 deep-merge patch
 *   - `DELETE /:sid`         — delete a disabled, idle schedule
 *   - `POST   /:sid/run`     — manual fire-now
 *   - `GET    /:sid/preview` — upcoming fire timestamps; `?n=` in `[1, 100]`
 */

import {
  CreateScheduleRequestSchema,
  CreateScheduleResponseSchema,
  DeleteScheduleResponseSchema,
  describeCron,
  GetScheduleResponseSchema,
  ListSchedulesResponseSchema,
  PatchScheduleRequestSchema,
  PatchScheduleResponseSchema,
  PreviewScheduleResponseSchema,
  RunScheduleResponseSchema,
  type ScheduleModule,
  type ScheduleTrigger,
} from "@glyphs-ai/schedule";
import {
  ListTasksRequestSchema,
  ListTasksResponseSchema,
  TaskBriefSchema,
  type TaskModule,
  type TaskStatus,
} from "@glyphs-ai/task";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondScheduleError } from "../../_error-policies/schedules.js";
import { respondTaskError } from "../../_error-policies/tasks.js";
import { logEvent, problemResponse } from "../../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../../_http-helpers.js";

type ScheduleServiceResolver = (c: Context) => ScheduleModule;

// ─── Concrete task-target request shapes ─────────────────────────────

const TaskTargetDataRequestSchema = z
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

const TaskTargetPatchRequestSchema = z
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

// ─── Concrete task-target response shapes ────────────────────────────

const TaskScheduleTargetSchema = z.object({
  agent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
  runtime: z.string().optional(),
});

/**
 * The `target.data` shape this module persists (opaque `unknown` in the
 * substrate view). Each route maps it INLINE into its own response type —
 * `{ ...view, target: data }` (the kind is implied by the URL path, so the
 * wire target drops it) — deriving that type from the schedule pkg's matching
 * response schema, so no route depends on another.
 */
type TaskTargetData = z.infer<typeof TaskScheduleTargetSchema>;

export function schedulesTaskRoutes(resolve: ScheduleServiceResolver): OpenAPIHono {
  const app = createApiApp();

  // ── GET / — list task schedules ───────────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["schedules"],
      summary: "List task schedules",
      request: {
        query: z.object({
          agent: z.string().optional(),
          enabled: z.enum(["true", "false"]).optional(),
        }),
      },
      responses: {
        200: jsonResponse(
          ListSchedulesResponseSchema.unwrap()
            .element.extend({ target: TaskScheduleTargetSchema })
            .array(),
          "Task schedules",
        ),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const { agent, enabled } = c.req.valid("query");
      try {
        // `?agent=` + `kind: "task"` engages the partial index
        // `schedules_target_agent_idx` (defined `WHERE target_kind='task'`).
        const listed = await resolve(c).listSchedules.execute({
          kind: "task",
          ...(agent !== undefined ? { dataEquals: { path: "$.agent", value: agent } } : {}),
          ...(enabled !== undefined ? { enabled: enabled === "true" } : {}),
        });
        if (listed.isErr()) {
          return respondScheduleError(c, listed.error, { route: "schedules.task.list" });
        }
        return c.json(
          listed.value.map((s) => ({
            ...s,
            target: s.target.data as TaskTargetData,
          })),
        );
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.list" });
      }
    },
  );

  // ── POST / — create a task schedule ───────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["schedules"],
      summary: "Create a task schedule",
      request: {
        body: jsonRequest(
          CreateScheduleRequestSchema.extend({ target: TaskTargetDataRequestSchema }).strict(),
        ),
      },
      responses: {
        201: jsonResponse(
          CreateScheduleResponseSchema.extend({ target: TaskScheduleTargetSchema }),
          "Created schedule",
        ),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const trigger: ScheduleTrigger = body.trigger;
      try {
        const created = await resolve(c).createSchedule.execute({
          name: body.name,
          trigger,
          target: { kind: "task", data: body.target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        if (created.isErr()) {
          return respondScheduleError(c, created.error, { route: "schedules.task.create" });
        }
        logEvent(c, "schedule.create", {
          scheduleId: created.value.id,
          agent: body.target.agent,
        });
        return c.json(
          {
            ...created.value,
            target: created.value.target.data as TaskTargetData,
          },
          201,
        );
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.create" });
      }
    },
  );

  // ── GET /:sid — get one task schedule ─────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Get a task schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(
          GetScheduleResponseSchema.unwrap().extend({
            target: TaskScheduleTargetSchema,
            describe: z.string(),
          }),
          "Task schedule",
        ),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const found = await resolve(c).getSchedule.execute({ id: sid, expectedKind: "task" });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.task.get" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            { route: "schedules.task.get" },
          );
        }
        // `describe` is derived from `trigger.expr` (NOT persisted) so a
        // dashboard `show` renders the human-readable cron without a round-trip.
        return c.json({
          ...found.value,
          target: found.value.target.data as TaskTargetData,
          describe: describeCron(found.value.trigger.expr),
        });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.get" });
      }
    },
  );

  // ── PATCH /:sid — patch a task schedule ───────────────────────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Patch a task schedule",
      request: {
        params: z.object({ sid: z.string() }),
        body: jsonRequest(
          PatchScheduleRequestSchema.omit({ id: true, expectedKind: true, target: true })
            .extend({ target: TaskTargetPatchRequestSchema.optional() })
            .strict(),
        ),
      },
      responses: {
        200: jsonResponse(
          PatchScheduleResponseSchema.extend({ target: TaskScheduleTargetSchema }),
          "Updated schedule",
        ),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const body = c.req.valid("json");
      const trigger: ScheduleTrigger | undefined = body.trigger;
      try {
        const updated = await resolve(c).patchSchedule.execute({
          id: sid,
          expectedKind: "task",
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(body.target !== undefined ? { target: { patch: body.target } } : {}),
        });
        if (updated.isErr()) {
          // A `ScheduleKindMismatch` (this id is a workflow) is projected to a
          // generic `ScheduleNotFound` 404 so the wire never leaks the kind.
          if (updated.error.type === "ScheduleKindMismatch") {
            return respondScheduleError(
              c,
              { type: "ScheduleNotFound", id: sid },
              { route: "schedules.task.patch" },
            );
          }
          return respondScheduleError(c, updated.error, { route: "schedules.task.patch" });
        }
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json({
          ...updated.value,
          target: updated.value.target.data as TaskTargetData,
        });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.patch" });
      }
    },
  );

  // ── DELETE /:sid ──────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Delete a task schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(
          DeleteScheduleResponseSchema.extend({ ok: z.literal(true) }),
          "Delete outcome",
        ),
        404: errorResponse("Schedule not found"),
        409: errorResponse("Schedule enabled or has in-flight dispatch"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const deleted = await resolve(c).deleteSchedule.execute({ id: sid, expectedKind: "task" });
        if (deleted.isErr()) {
          return respondScheduleError(c, deleted.error, { route: "schedules.task.delete" });
        }
        const { deletedDispatchCount } = deleted.value;
        logEvent(c, "schedule.delete", { scheduleId: sid, deletedDispatchCount });
        return c.json({ ok: true as const, deletedDispatchCount });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.delete" });
      }
    },
  );

  // ── POST /:sid/run — manual fire-now ──────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{sid}/run",
      tags: ["schedules"],
      summary: "Manually fire a task schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(RunScheduleResponseSchema, "Dispatch id"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const ran = await resolve(c).runSchedule.execute({ id: sid, expectedKind: "task" });
        if (ran.isErr()) {
          return respondScheduleError(c, ran.error, { route: "schedules.task.run" });
        }
        const { dispatchId } = ran.value;
        logEvent(c, "schedule.run", { scheduleId: sid, dispatchId });
        return c.json({ dispatchId });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.run" });
      }
    },
  );

  // ── GET /:sid/preview — upcoming fires ────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}/preview",
      tags: ["schedules"],
      summary: "Preview a task schedule's upcoming fires",
      request: {
        params: z.object({ sid: z.string() }),
        query: z.object({ n: z.coerce.number().int().min(1).max(100).optional() }),
      },
      responses: {
        200: jsonResponse(PreviewScheduleResponseSchema, "Schedule preview"),
        400: errorResponse("Malformed query"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const { n } = c.req.valid("query");
      try {
        const svc = resolve(c);
        const found = await svc.getSchedule.execute({ id: sid, expectedKind: "task" });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.task.preview" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            { route: "schedules.task.preview" },
          );
        }
        const preview = await svc.previewSchedule.execute({
          expr: found.value.trigger.expr,
          tz: found.value.trigger.tz,
          n: n ?? 3,
        });
        if (preview.isErr()) {
          return respondScheduleError(c, preview.error, { route: "schedules.task.preview" });
        }
        return c.json(preview.value);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.preview" });
      }
    },
  );

  return app;
}

/**
 * Routes for `/api/workspaces/:id/scheduled-tasks` — the tasks a schedule has
 * launched. Distinct from the CRUD surface above: this lists task RUNS
 * (`origin: "schedule"`), the CRUD lists schedule DEFINITIONS.
 */
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
          return problemResponse(c, 400, {
            code: "BadRequest",
            detail: "createdSince must be an ISO 8601 timestamp",
          });
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
