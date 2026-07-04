/**
 * Routes for `/api/workspaces/:id/schedules/workflow` — workflow-kind schedule
 * CRUD + run + preview. The kind is fixed by the mount path; every id-scoped op
 * passes `expectedKind: "workflow"` so a task-kind row under the same id reads
 * as absent (404), and the wire never leaks the other kind.
 *
 * The `@glyphs-ai/schedule` substrate is kind-agnostic and stores the target
 * opaquely as `{ kind, data: unknown }`. This module owns the CONCRETE
 * workflow-target wire shape (`{ coordinatorAgent, brief, details? }`) and
 * enriches list / get responses with `fireStats` (running / awaiting-human
 * counts) aggregated from the workflows a schedule has launched.
 *
 * ## Endpoints (mounted under `/schedules/workflow`)
 *
 *   - `GET    /`             — list workflow schedules; `?coordinatorAgent=`, `?enabled=`
 *   - `POST   /`             — create a workflow schedule
 *   - `GET    /:sid`         — get one (enriched with `describe` + `fireStats`)
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
  ListWorkflowsResponseSchema,
  WorkflowBriefSchema,
  type WorkflowModule,
} from "@glyphs-ai/workflow";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { respondScheduleError } from "../../_error-policies/schedules.js";
import { respondWorkflowError, workflowsErrorPolicy } from "../../_error-policies/workflows.js";
import { logEvent } from "../../_http-errors.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "../../_http-helpers.js";

type ScheduleServiceResolver = (c: Context) => ScheduleModule;
type WorkflowServiceResolver = (c: Context) => WorkflowModule;

// ─── Concrete workflow-target request shapes ─────────────────────────

const WorkflowTargetDataRequestSchema = z
  .object({
    coordinatorAgent: z.string().refine((s) => s.trim().length > 0, {
      message: "target.coordinatorAgent must be a non-empty string",
    }),
    brief: WorkflowBriefSchema,
    details: z.string().optional(),
  })
  .strict();

const WorkflowTargetPatchRequestSchema = z
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

// ─── Concrete workflow-target response shapes ────────────────────────

const WorkflowScheduleTargetSchema = z.object({
  coordinatorAgent: z.string(),
  brief: z.string(),
  details: z.string().optional(),
});

const FireStatsSchema = z.object({ awaitingCount: z.number(), runningCount: z.number() });

type FireStats = z.infer<typeof FireStatsSchema>;

/**
 * The `target.data` shape this module persists (opaque `unknown` in the
 * substrate view). Each route maps it INLINE into its own response type —
 * `{ ...view, target: data, fireStats }` (the kind is implied by the URL path,
 * so the wire target drops it) — deriving that type from the schedule pkg's
 * matching response schema, so no route depends on another.
 */
type WorkflowTargetData = z.infer<typeof WorkflowScheduleTargetSchema>;

const ZERO_FIRE_STATS: FireStats = { awaitingCount: 0, runningCount: 0 };

export function schedulesWorkflowRoutes(
  resolve: ScheduleServiceResolver,
  resolveWorkflowService: WorkflowServiceResolver,
): OpenAPIHono {
  const app = createApiApp();

  /**
   * Aggregate per-schedule running / awaiting-human counts for the workflows
   * these schedules launched (`origin = "schedule"`, keyed by `originId = the
   * schedule id`). Throws on an aggregate fault (caught by the caller → 500).
   */
  async function fireStatsFor(
    c: Context,
    views: readonly { readonly id: string }[],
  ): Promise<ReadonlyMap<string, FireStats>> {
    const ids = views.map((v) => v.id);
    if (ids.length === 0) return new Map();
    const aggregated = await resolveWorkflowService(c).aggregateByOrigin.execute({
      origin: "schedule",
      originIds: ids,
      statusIn: ["running"],
    });
    if (aggregated.isErr()) throw new Error(aggregated.error.type);
    const stats = new Map<string, FireStats>();
    for (const [id, agg] of Object.entries(aggregated.value)) {
      stats.set(id, { awaitingCount: agg.awaitingCount, runningCount: agg.runningCount });
    }
    return stats;
  }

  // ── GET / — list workflow schedules ───────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["schedules"],
      summary: "List workflow schedules",
      request: {
        query: z.object({
          coordinatorAgent: z.string().optional(),
          enabled: z.enum(["true", "false"]).optional(),
        }),
      },
      responses: {
        200: jsonResponse(
          ListSchedulesResponseSchema.unwrap()
            .element.extend({ target: WorkflowScheduleTargetSchema, fireStats: FireStatsSchema })
            .array(),
          "Workflow schedules",
        ),
        400: errorResponse("Malformed query"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const { coordinatorAgent, enabled } = c.req.valid("query");
      try {
        const listed = await resolve(c).listSchedules.execute({
          kind: "workflow",
          ...(coordinatorAgent !== undefined
            ? { dataEquals: { path: "$.coordinatorAgent", value: coordinatorAgent } }
            : {}),
          ...(enabled !== undefined ? { enabled: enabled === "true" } : {}),
        });
        if (listed.isErr()) {
          return respondScheduleError(c, listed.error, { route: "schedules.workflow.list" });
        }
        const stats = await fireStatsFor(c, listed.value);
        return c.json(
          listed.value.map((s) => ({
            ...s,
            target: s.target.data as WorkflowTargetData,
            fireStats: stats.get(s.id) ?? ZERO_FIRE_STATS,
          })),
        );
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.list" });
      }
    },
  );

  // ── POST / — create a workflow schedule ───────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["schedules"],
      summary: "Create a workflow schedule",
      request: {
        body: jsonRequest(
          CreateScheduleRequestSchema.extend({ target: WorkflowTargetDataRequestSchema }).strict(),
        ),
      },
      responses: {
        201: jsonResponse(
          CreateScheduleResponseSchema.extend({
            target: WorkflowScheduleTargetSchema,
            fireStats: FireStatsSchema,
          }),
          "Created schedule",
        ),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Coordinator agent not found"),
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
          target: { kind: "workflow", data: body.target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        if (created.isErr()) {
          return respondScheduleError(c, created.error, { route: "schedules.workflow.create" });
        }
        logEvent(c, "schedule.create", {
          scheduleId: created.value.id,
          coordinatorAgent: body.target.coordinatorAgent,
        });
        // A freshly-created schedule has launched nothing yet.
        return c.json(
          {
            ...created.value,
            target: created.value.target.data as WorkflowTargetData,
            fireStats: ZERO_FIRE_STATS,
          },
          201,
        );
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.create" });
      }
    },
  );

  // ── GET /:sid — get one workflow schedule ─────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Get a workflow schedule",
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(
          GetScheduleResponseSchema.unwrap().extend({
            target: WorkflowScheduleTargetSchema,
            fireStats: FireStatsSchema,
            describe: z.string(),
          }),
          "Workflow schedule",
        ),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      try {
        const found = await resolve(c).getSchedule.execute({ id: sid, expectedKind: "workflow" });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.workflow.get" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            { route: "schedules.workflow.get" },
          );
        }
        const stats = await fireStatsFor(c, [found.value]);
        return c.json({
          ...found.value,
          target: found.value.target.data as WorkflowTargetData,
          fireStats: stats.get(sid) ?? ZERO_FIRE_STATS,
          describe: describeCron(found.value.trigger.expr),
        });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.get" });
      }
    },
  );

  // ── PATCH /:sid — patch a workflow schedule ───────────────────────
  app.openapi(
    createRoute({
      method: "patch",
      path: "/{sid}",
      tags: ["schedules"],
      summary: "Patch a workflow schedule",
      request: {
        params: z.object({ sid: z.string() }),
        body: jsonRequest(
          PatchScheduleRequestSchema.omit({ id: true, expectedKind: true, target: true })
            .extend({ target: WorkflowTargetPatchRequestSchema.optional() })
            .strict(),
        ),
      },
      responses: {
        200: jsonResponse(
          PatchScheduleResponseSchema.extend({
            target: WorkflowScheduleTargetSchema,
            fireStats: FireStatsSchema,
          }),
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
        const svc = resolve(c);
        const updated = await svc.patchSchedule.execute({
          id: sid,
          expectedKind: "workflow",
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(body.target !== undefined ? { target: { patch: body.target } } : {}),
        });
        if (updated.isErr()) {
          // A `ScheduleKindMismatch` (this id is a task) is projected to a
          // generic `ScheduleNotFound` 404 so the wire never leaks the kind.
          if (updated.error.type === "ScheduleKindMismatch") {
            return respondScheduleError(
              c,
              { type: "ScheduleNotFound", id: sid },
              { route: "schedules.workflow.patch" },
            );
          }
          return respondScheduleError(c, updated.error, { route: "schedules.workflow.patch" });
        }
        logEvent(c, "schedule.patch", { scheduleId: sid });
        const stats = await fireStatsFor(c, [updated.value]);
        return c.json({
          ...updated.value,
          target: updated.value.target.data as WorkflowTargetData,
          fireStats: stats.get(sid) ?? ZERO_FIRE_STATS,
        });
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
      summary: "Delete a workflow schedule",
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
        const deleted = await resolve(c).deleteSchedule.execute({
          id: sid,
          expectedKind: "workflow",
        });
        if (deleted.isErr()) {
          return respondScheduleError(c, deleted.error, { route: "schedules.workflow.delete" });
        }
        const { deletedDispatchCount } = deleted.value;
        logEvent(c, "schedule.delete", { scheduleId: sid, deletedDispatchCount });
        return c.json({ ok: true as const, deletedDispatchCount });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.delete" });
      }
    },
  );

  // ── POST /:sid/run — manual fire-now ──────────────────────────────
  app.openapi(
    createRoute({
      method: "post",
      path: "/{sid}/run",
      tags: ["schedules"],
      summary: "Manually fire a workflow schedule",
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
        const ran = await resolve(c).runSchedule.execute({ id: sid, expectedKind: "workflow" });
        if (ran.isErr()) {
          return respondScheduleError(c, ran.error, { route: "schedules.workflow.run" });
        }
        const { dispatchId } = ran.value;
        logEvent(c, "schedule.run", { scheduleId: sid, dispatchId });
        return c.json({ dispatchId });
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.run" });
      }
    },
  );

  // ── GET /:sid/preview — upcoming fires ────────────────────────────
  app.openapi(
    createRoute({
      method: "get",
      path: "/{sid}/preview",
      tags: ["schedules"],
      summary: "Preview a workflow schedule's upcoming fires",
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
        const found = await svc.getSchedule.execute({ id: sid, expectedKind: "workflow" });
        if (found.isErr()) {
          return respondScheduleError(c, found.error, { route: "schedules.workflow.preview" });
        }
        if (found.value === null) {
          return respondScheduleError(
            c,
            { type: "ScheduleNotFound", id: sid },
            { route: "schedules.workflow.preview" },
          );
        }
        const preview = await svc.previewSchedule.execute({
          expr: found.value.trigger.expr,
          tz: found.value.trigger.tz,
          n: n ?? 3,
        });
        if (preview.isErr()) {
          return respondScheduleError(c, preview.error, { route: "schedules.workflow.preview" });
        }
        return c.json(preview.value);
      } catch (err) {
        return respondScheduleError(c, err, { route: "schedules.workflow.preview" });
      }
    },
  );

  return app;
}

/**
 * Routes for `/api/workspaces/:id/scheduled-workflows` — the workflows a
 * schedule has launched (`origin: "schedule"`). Distinct from the CRUD surface
 * above: this lists workflow RUNS, the CRUD lists schedule DEFINITIONS.
 *
 * This route is **schedule-origin-only by construction** — the filter is
 * hardcoded to workflows whose `origin` is `"schedule"`. Splitting at the URL
 * layer (instead of via a `?origin=` discriminator on `/workflows`) means each
 * origin's caller surface gets a route whose URL IS the contract; callers
 * cannot accidentally widen the result set.
 */
export function scheduledWorkflowsRoutes(
  resolveWorkflowService: WorkflowServiceResolver,
): OpenAPIHono {
  const app = createApiApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["workflows"],
      summary: "List schedule-origin workflows",
      request: { query: z.object({ scheduleId: z.string().optional() }) },
      responses: {
        200: jsonResponse(ListWorkflowsResponseSchema, "Workflows"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const scheduleId = c.req.query("scheduleId");

      try {
        const svc = resolveWorkflowService(c);
        // Narrow to schedule-origin workflows — optionally to a single
        // schedule — through the typed `(origin, origin_id)` column pair,
        // so the `?scheduleId=` filter is served from
        // `workflows_origin_pair_idx` with no `metadata` JSON probing.
        const filtered = await svc.listWorkflows.execute({
          origin: "schedule",
          ...(scheduleId !== undefined ? { originId: scheduleId } : {}),
        });
        if (filtered.isErr()) throw filtered.error;
        return c.json(filtered.value);
      } catch (err) {
        return respondWorkflowError(c, err, {
          route: "scheduled-workflows.list",
          policy: workflowsErrorPolicy,
        });
      }
    },
  );

  return app;
}
