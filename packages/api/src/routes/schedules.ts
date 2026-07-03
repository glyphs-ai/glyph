/**
 * Routes for `/api/workspaces/:wsId/schedules`. Sibling of
 * `routes/scheduled-tasks.ts` — this file owns CRUD + run + preview for the
 * cron-trigger entities themselves; that file owns the read-only list of tasks
 * the trigger has produced.
 *
 * Resolver-injection pattern matches `routes/tasks.ts`: the mount point hands
 * in a function that pulls the workspace-scoped {@link ScheduleModule} out of
 * Hono's per-request context. Handlers call `resolve(c).<useCase>.execute(...)`
 * (Result-native) and map an `isErr()` to the wire via
 * {@link respondScheduleError}.
 *
 * ## Mutation routes (URL-discriminated by target kind)
 *
 *   - `POST /task` / `PATCH /task/:sid`         — task-kind
 *   - `POST /workflow` / `PATCH /workflow/:sid` — workflow-kind
 *
 * Each kind offers an honest RFC 7396-style deep-merge on its body. Reads
 * (`GET /`, `GET /:sid`, `GET /:sid/preview`, `GET /preview-cron`) and
 * lifecycle ops (`DELETE /:sid`, `POST /:sid/run`) stay polymorphic over kind.
 *
 * Notes:
 *   - `GET /:sid` — `getSchedule` returns `view | null`. `null` maps to a
 *     `ScheduleNotFound` 404 envelope. The success payload is enriched with a
 *     derived `describe` (English cron text) computed from `trigger.expr` (NOT
 *     persisted).
 *   - `GET /:sid/preview` — `?n=` bounded `[1, 100]` at the route boundary AND
 *     inside `previewSchedule`.
 *   - `GET /preview-cron` — unscoped preview for an arbitrary `(expr, tz)`;
 *     defaults `n` to 5 (modal count). MUST register before `/:sid` so the
 *     literal path wins over the `:sid` param match.
 *   - A `PATCH /<kind>/:sid` whose `:sid` exists under a DIFFERENT kind returns
 *     a generic `ScheduleNotFound` 404 — the wire must not leak the actual kind.
 */

import {
  type CreateScheduleResponse,
  describeCron,
  type ScheduleModule,
  type ScheduleTrigger,
} from "@glyphs-ai/schedule";
import type { WorkflowModule } from "@glyphs-ai/workflow";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { respondScheduleError } from "../_error-policies/schedules.js";
import { logEvent } from "../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../_http-helpers.js";
import {
  CreateTaskScheduleRequestSchema,
  CreateWorkflowScheduleRequestSchema,
  PatchTaskScheduleRequestSchema,
  PatchWorkflowScheduleRequestSchema,
  PreviewScheduleResultSchema,
  ScheduleDeleteResponseSchema,
  ScheduleGetResponseSchema,
  type ScheduleHeader,
  ScheduleHeaderSchema,
  SchedulePreviewQuerySchema,
  ScheduleRunResponseSchema,
} from "../schemas/schedules.js";
import type { TaskTargetData, WorkflowTargetData } from "../wire/schedules.js";

type ScheduleServiceResolver = (c: import("hono").Context) => ScheduleModule;
type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowModule;

/** The non-null schedule view every use-case returns; used as the projection input. */
type ScheduleView = CreateScheduleResponse;

function collectWorkflowFireStats(
  aggregated: ReadonlyMap<string, { runningCount: number; awaitingCount: number }>,
): ReadonlyMap<string, NonNullable<ScheduleHeader["fireStats"]>> {
  const stats = new Map<string, NonNullable<ScheduleHeader["fireStats"]>>();
  for (const [scheduleId, { runningCount, awaitingCount }] of aggregated) {
    stats.set(scheduleId, { runningCount, awaitingCount });
  }
  return stats;
}

/**
 * Project the internal schedule view to the flat wire header. The schedule pkg
 * is kind-agnostic and stores `{ kind: "task", data: { agent, ... } }`; the
 * wire shape stays flat (`{ kind: "task", agent, ... }`) so dashboard / CLI
 * `schedule.target.agent` reads keep working.
 */
function projectScheduleHeader(
  s: ScheduleView,
  workflowFireStats?: ReadonlyMap<string, NonNullable<ScheduleHeader["fireStats"]>>,
): ScheduleHeader {
  if (s.target.kind === "task") {
    const data = s.target.data as TaskTargetData;
    return {
      ...s,
      target: {
        kind: "task",
        agent: data.agent,
        brief: data.brief,
        ...(data.details !== undefined ? { details: data.details } : {}),
        ...(data.runtime !== undefined ? { runtime: data.runtime } : {}),
      },
    };
  }
  if (s.target.kind === "workflow") {
    const data = s.target.data as WorkflowTargetData;
    const fireStats = workflowFireStats?.get(s.id);
    return {
      ...s,
      target: {
        kind: "workflow",
        coordinatorAgent: data.coordinatorAgent,
        brief: data.brief,
        ...(data.details !== undefined ? { details: data.details } : {}),
      },
      ...(fireStats !== undefined ? { fireStats } : {}),
    };
  }
  return s as ScheduleHeader;
}

export function schedulesRoutes(
  resolve: ScheduleServiceResolver,
  resolveWorkflowService?: WorkflowServiceResolver,
): OpenAPIHono {
  const app = createApiApp();

  /**
   * Compute per-schedule workflow fireStats for the workflow-kind rows in
   * `views`, or `undefined` when no workflow rows / no resolver. Throws on a
   * workflow-aggregate fault (caught by the caller's try/catch → 500).
   */
  async function workflowFireStatsFor(
    c: import("hono").Context,
    views: readonly ScheduleView[],
  ): Promise<ReadonlyMap<string, NonNullable<ScheduleHeader["fireStats"]>> | undefined> {
    if (resolveWorkflowService === undefined) return undefined;
    const workflowIds = views.filter((v) => v.target.kind === "workflow").map((v) => v.id);
    if (workflowIds.length === 0) return undefined;
    const aggregated = await resolveWorkflowService(c).aggregateByOrigin.execute({
      origin: "schedule",
      originIds: workflowIds,
      statusIn: ["running"],
    });
    if (aggregated.isErr()) throw new Error(aggregated.error.type);
    return collectWorkflowFireStats(new Map(Object.entries(aggregated.value)));
  }

  // ── GET / — list with optional agent / enabled filters ────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["schedules"],
      summary: "List schedules",
      request: {
        query: z.object({ agent: z.string().optional(), enabled: z.string().optional() }),
      },
      responses: {
        200: jsonResponse(ScheduleHeaderSchema.array(), "Schedules"),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const agent = c.req.query("agent");
      const enabledRaw = c.req.query("enabled");
      let enabled: boolean | undefined;
      if (enabledRaw !== undefined) {
        if (enabledRaw !== "true" && enabledRaw !== "false") {
          return c.json({ error: 'enabled must be "true" or "false"' }, 400);
        }
        enabled = enabledRaw === "true";
      }
      try {
        // The `?agent=` query maps to `{ kind: "task", dataEquals: { path:
        // "$.agent", value } }` — both predicates together engage the partial
        // index `schedules_target_agent_idx` (defined `WHERE target_kind='task'`).
        const listed = await resolve(c).listSchedules.execute({
          ...(agent !== undefined
            ? { kind: "task" as const, dataEquals: { path: "$.agent", value: agent } }
            : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        });
        if (listed.isErr()) {
          return respondScheduleError(c, listed.error, { route: "schedules.list" });
        }
        const list = listed.value;
        const fireStats = await workflowFireStatsFor(c, list);
        return c.json(list.map((schedule) => projectScheduleHeader(schedule, fireStats)));
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.list" });
      }
    },
  );

  // ── POST /task — create a task-kind schedule ──────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/task",
      tags: ["schedules"],
      summary: "Create a task-kind schedule",
      request: { body: jsonRequest(CreateTaskScheduleRequestSchema) },
      responses: {
        201: jsonResponse(ScheduleHeaderSchema, "Created schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const target = body.target;
      const trigger: ScheduleTrigger = body.trigger;
      try {
        const created = await resolve(c).createSchedule.execute({
          name: body.name,
          trigger,
          target: { kind: "task", data: target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        if (created.isErr()) {
          return respondScheduleError(c, created.error, { route: "schedules.task.create" });
        }
        logEvent(c, "schedule.create", { scheduleId: created.value.id, agent: target.agent });
        return c.json(projectScheduleHeader(created.value), 201);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.create" });
      }
    },
  );

  // ── GET /preview-cron — preview an arbitrary (expr, tz) ──────────
  // Registered BEFORE `/:sid` so the literal path wins over the param match.
  app.openapi(
    createRoute({
      method: "get",
      path: "/preview-cron",
      tags: ["schedules"],
      summary: "Preview an arbitrary cron expression",
      request: {
        query: z.object({
          expr: z.string().optional(),
          tz: z.string().optional(),
          n: z.string().optional(),
        }),
      },
      responses: {
        200: jsonResponse(PreviewScheduleResultSchema, "Cron preview"),
        400: errorResponse("Missing or malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const expr = c.req.query("expr");
      const tz = c.req.query("tz");
      if (typeof expr !== "string" || expr.trim() === "") {
        return c.json({ error: "expr query param is required" }, 400);
      }
      if (typeof tz !== "string" || tz.trim() === "") {
        return c.json({ error: "tz query param is required" }, 400);
      }
      // Modal default of 5 (vs the /:sid/preview default of 3).
      let n = 5;
      const nRaw = c.req.query("n");
      if (nRaw !== undefined) {
        const parsed = Number.parseInt(nRaw, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || `${parsed}` !== nRaw) {
          return c.json(
            { error: "n must be an integer in [1, 100]", code: "PreviewCountOutOfRange" },
            400,
          );
        }
        n = parsed;
      }
      try {
        const preview = await resolve(c).previewSchedule.execute({ expr, tz, n });
        if (preview.isErr()) {
          return respondScheduleError(c, preview.error, { route: "schedules.previewCron" });
        }
        return c.json(preview.value);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.previewCron" });
      }
    },
  );

  // ── GET /:sid — get one ───────────────────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Get a schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(ScheduleGetResponseSchema, "Schedule"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const found = await resolve(c).getSchedule.execute({ id: sid });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.get" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            {
              route: "schedules.get",
            },
          );
        }
        const schedule = found.value;
        // Enrich with derived cron `describe` so dashboards / CLI `show` render
        // the human-readable text without a second round-trip. NOT persisted —
        // `trigger.expr` is the single source of truth.
        const fireStats = await workflowFireStatsFor(c, [schedule]);
        return c.json({
          ...projectScheduleHeader(schedule, fireStats),
          describe: describeCron(schedule.trigger.expr),
        });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.get" });
      }
    },
  );

  // ── PATCH /task/:sid — patch a task-kind schedule ─────────────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/task/{sid}",
      tags: ["schedules"],
      summary: "Patch a task-kind schedule",
      request: {
        params: z.object({ sid: z.string() }),
        body: jsonRequest(PatchTaskScheduleRequestSchema),
      },
      responses: {
        200: jsonResponse(ScheduleHeaderSchema, "Updated schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const body = c.req.valid("json");
      const target = body.target;
      const trigger: ScheduleTrigger | undefined = body.trigger;
      try {
        const updated = await resolve(c).patchSchedule.execute({
          id: sid,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(target !== undefined ? { target: { patch: target } } : {}),
          expectedKind: "task",
        });
        if (updated.isErr()) {
          return respondPatchError(c, sid, updated.error, "schedules.task.patch");
        }
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json(projectScheduleHeader(updated.value));
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.task.patch" });
      }
    },
  );

  // ── POST /workflow — create a workflow-kind schedule ───────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/workflow",
      tags: ["schedules"],
      summary: "Create a workflow-kind schedule",
      request: { body: jsonRequest(CreateWorkflowScheduleRequestSchema) },
      responses: {
        201: jsonResponse(ScheduleHeaderSchema, "Created schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Coordinator agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const target = body.target;
      const trigger: ScheduleTrigger = body.trigger;
      try {
        const created = await resolve(c).createSchedule.execute({
          name: body.name,
          trigger,
          target: { kind: "workflow", data: target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        if (created.isErr()) {
          return respondScheduleError(c, created.error, { route: "schedules.workflow.create" });
        }
        logEvent(c, "schedule.create", {
          scheduleId: created.value.id,
          coordinatorAgent: target.coordinatorAgent,
        });
        return c.json(projectScheduleHeader(created.value), 201);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.create" });
      }
    },
  );

  // ── PATCH /workflow/:sid — patch a workflow-kind schedule ──────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/workflow/{sid}",
      tags: ["schedules"],
      summary: "Patch a workflow-kind schedule",
      request: {
        params: z.object({ sid: z.string() }),
        body: jsonRequest(PatchWorkflowScheduleRequestSchema),
      },
      responses: {
        200: jsonResponse(ScheduleHeaderSchema, "Updated schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const body = c.req.valid("json");
      const target = body.target;
      const trigger: ScheduleTrigger | undefined = body.trigger;
      try {
        const updated = await resolve(c).patchSchedule.execute({
          id: sid,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(target !== undefined ? { target: { patch: target } } : {}),
          expectedKind: "workflow",
        });
        if (updated.isErr()) {
          return respondPatchError(c, sid, updated.error, "schedules.workflow.patch");
        }
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json(projectScheduleHeader(updated.value));
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.patch" });
      }
    },
  );

  // ── DELETE /:sid ──────────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: "delete",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Delete a schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(ScheduleDeleteResponseSchema, "Delete outcome"),
        404: errorResponse("Schedule not found"),
        409: errorResponse("Schedule has in-flight dispatch"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const deleted = await resolve(c).deleteSchedule.execute({ id: sid });
        if (deleted.isErr()) {
          return respondScheduleError(c, deleted.error, { route: "schedules.delete" });
        }
        const { deletedDispatchCount } = deleted.value;
        logEvent(c, "schedule.delete", { scheduleId: sid, deletedDispatchCount });
        return c.json({ ok: true as const, deletedDispatchCount });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.delete" });
      }
    },
  );

  // ── POST /:sid/run — manual fire-now ──────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{sid}/run",
      tags: ["schedules"],
      summary: "Manually fire a schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(ScheduleRunResponseSchema, "Dispatch id"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const ran = await resolve(c).runSchedule.execute({ id: sid });
        if (ran.isErr()) {
          return respondScheduleError(c, ran.error, { route: "schedules.run" });
        }
        const { dispatchId } = ran.value;
        logEvent(c, "schedule.run", { scheduleId: sid, dispatchId });
        return c.json({ dispatchId });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.run" });
      }
    },
  );

  // ── GET /:sid/preview ─────────────────────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}/preview",
      tags: ["schedules"],
      summary: "Preview a schedule's upcoming fires",
      request: {
        params: z.object({ sid: z.string() }),
        query: SchedulePreviewQuerySchema,
      },
      responses: {
        200: jsonResponse(PreviewScheduleResultSchema, "Schedule preview"),
        400: errorResponse("Malformed query"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const nRaw = c.req.query("n");
      let n: number | undefined;
      if (nRaw !== undefined) {
        const parsed = Number.parseInt(nRaw, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || `${parsed}` !== nRaw) {
          return c.json(
            { error: "n must be an integer in [1, 100]", code: "PreviewCountOutOfRange" },
            400,
          );
        }
        n = parsed;
      }
      try {
        const svc = resolve(c);
        const found = await svc.getSchedule.execute({ id: sid });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.preview" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            {
              route: "schedules.preview",
            },
          );
        }
        const preview = await svc.previewSchedule.execute({
          expr: found.value.trigger.expr,
          tz: found.value.trigger.tz,
          n: n ?? 3,
        });
        if (preview.isErr()) {
          return respondScheduleError(c, preview.error, { route: "schedules.preview" });
        }
        return c.json(preview.value);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.preview" });
      }
    },
  );

  return app;
}

/**
 * Patch-error mapping shared by the task/workflow patch routes: a
 * `ScheduleKindMismatch` is projected to a generic `ScheduleNotFound` 404 so
 * the wire never leaks that `:sid` exists under a different kind; everything
 * else flows through the standard policy.
 */
function respondPatchError(
  c: import("hono").Context,
  sid: string,
  err: { readonly type: string; readonly expected?: string; readonly actual?: string },
  route: string,
): Response {
  if (err.type === "ScheduleKindMismatch") {
    logEvent(c, "schedule.patch.kind_mismatch", {
      scheduleId: sid,
      expected: err.expected,
      actual: err.actual,
    });
    return respondScheduleError(c, { type: "ScheduleNotFound", id: sid }, { route });
  }
  return respondScheduleError(c, err, { route });
}
