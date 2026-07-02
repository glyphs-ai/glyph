/**
 * Routes for `/api/workspaces/:wsId/schedules`. Sibling of
 * `routes/scheduled-tasks.ts` — this file owns CRUD + run + preview
 * for the cron-trigger entities themselves; that file owns the
 * read-only list of tasks the trigger has produced.
 *
 * Resolver-injection pattern matches `routes/tasks.ts` /
 * `routes/scheduled-tasks.ts`: the mount point hands in a function
 * that pulls the workspace-scoped `ScheduleService` out of Hono's
 * per-request context. The route file never touches workspace
 * resolution, only the schedule surface.
 *
 * ## Mutation routes (URL-discriminated by target kind)
 *
 * `POST` and `PATCH` are split by `target.kind` so each kind can
 * offer an honest, RFC 7396-style deep-merge contract on its body:
 *
 *   - `POST /task`        creates a task-kind schedule
 *   - `PATCH /task/:sid`  patches a task-kind schedule (RFC 7396
 *                         deep-merge on `target`; wholesale-replace
 *                         on `trigger`; scalar-set on
 *                         `name` / `enabled`)
 *
 * Reads (`GET /`, `GET /:sid`, `GET /:sid/preview`,
 * `GET /preview-cron`) and lifecycle ops (`DELETE /:sid`,
 * `POST /:sid/run`) stay polymorphic over kind.
 *
 * When a `workflow` target lands later it will get its own
 * `POST /workflow` + `PATCH /workflow/:sid` pair plus matching
 * service methods; no changes needed in the polymorphic routes.
 *
 * Notes:
 *
 *   - `GET /:sid` — `ScheduleService.get(sid)` returns `Schedule | null`
 *     rather than throwing on miss. The handler maps `null` to a
 *     `ScheduleNotFoundError`-shaped 404 envelope so dashboards /
 *     CLIs can `instanceof`-branch off the wire `code`. The success
 *     payload is enriched with a derived `describe` (zh_CN cron text)
 *     so callers can render it without a second round-trip; the
 *     field is computed from `trigger.expr`, NOT persisted.
 *   - `GET /:sid/preview` — `?n=` is bounded in `[1, 100]` at both
 *     the route boundary and inside `ScheduleService.preview` (see
 *     `packages/schedule/src/schedule-service.ts`). Out-of-range
 *     emits a typed 400 envelope; in-range plumbs straight through.
 *   - `GET /preview-cron` — unscoped preview for an arbitrary
 *     `(expr, tz)` pair, used by the dashboard's "New schedule"
 *     modal so the user can see `describe` + next-N fires before
 *     any entity exists. Same `[1, 100]` bound on
 *     `?n=`, but defaults to **5** (the modal's preview count),
 *     vs the `/:sid/preview` default of 3 (the detail page count).
 *     MUST be registered before `/:sid` so the literal path wins
 *     over the param match (`:sid = "preview-cron"` is the bug
 *     this ordering prevents).
 */

import type {
  ScheduleHeader,
  TaskTargetData,
  TaskTargetPatch,
  WorkflowTargetData,
  WorkflowTargetPatch,
} from "@glyphs-ai/api";
import {
  CreateTaskScheduleRequestSchema,
  CreateWorkflowScheduleRequestSchema,
  PatchTaskScheduleRequestSchema,
  PatchWorkflowScheduleRequestSchema,
  PreviewScheduleResultSchema,
  ScheduleDeleteResponseSchema,
  ScheduleGetResponseSchema,
  ScheduleHeaderSchema,
  SchedulePreviewQuerySchema,
  ScheduleRunResponseSchema,
} from "@glyphs-ai/api";
import {
  describeCron,
  type Schedule,
  ScheduleError,
  ScheduleKindMismatchError,
  ScheduleNotFoundError,
  type ScheduleService,
  type ScheduleTrigger,
} from "@glyphs-ai/schedule";
import type { WorkflowModule } from "@glyphs-ai/workflow";
// `ScheduleError` is used by both the `/:sid/preview` n-bound check
// and the new `/preview-cron` n-bound check for a typed
// envelope on rejection.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { schedulesErrorPolicy } from "./_error-policies/schedules.js";
import { createApiApp, errorResponse, jsonRequest, jsonResponse } from "./_openapi.js";
import { respondError } from "./_respond-error.js";
import { errorBody, logEvent } from "./_shared.js";

type ScheduleServiceResolver = (c: import("hono").Context) => ScheduleService;
type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowModule;

/**
 * Project the internal `Schedule` envelope to the flat wire shape
 * that dashboard / CLI consumers read. The schedule pkg is
 * kind-agnostic and stores `{ kind: "task", data: { agent, ... } }`;
 * the wire shape stays flat (`{ kind: "task", agent, ... }`) so the
 * dashboard / CLI's `schedule.target.agent` reads keep working.
 */
function collectWorkflowFireStats(
  aggregated: ReadonlyMap<string, { runningCount: number; awaitingCount: number }>,
): ReadonlyMap<string, NonNullable<ScheduleHeader["fireStats"]>> {
  const stats = new Map<string, NonNullable<ScheduleHeader["fireStats"]>>();
  for (const [scheduleId, { runningCount, awaitingCount }] of aggregated) {
    stats.set(scheduleId, { runningCount, awaitingCount });
  }
  return stats;
}

function projectScheduleHeader(
  s: Schedule,
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
  return s;
}

export function schedulesRoutes(
  resolve: ScheduleServiceResolver,
  resolveWorkflowService?: WorkflowServiceResolver,
): OpenAPIHono {
  const app = createApiApp();

  // ── GET / — list with optional agent / enabled filters ────────────
  // Query params `?agent=` and `?enabled=` are retained for CLI and
  // direct-API consumers. The dashboard now filters client-side
  // (kind tabs + search + chips) and does not send them, but they
  // remain part of the public contract.
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
        // The schedule pkg's list opts are kind-agnostic: the wire's
        // `?agent=` query maps to `{ kind: "task", dataEquals: {
        // path: "$.agent", value: agent } }`. The combination
        // engages the partial JSON-extract index
        // `schedules_target_agent_idx` (defined `WHERE
        // target_kind='task'`); both predicates must appear in the
        // WHERE clause for SQLite's planner to use it.
        const list = await resolve(c).list({
          ...(agent !== undefined
            ? { kind: "task" as const, dataEquals: { path: "$.agent", value: agent } }
            : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        });
        const workflowFireStats =
          resolveWorkflowService !== undefined &&
          list.some((schedule) => schedule.target.kind === "workflow")
            ? await (async () => {
                const workflowService = resolveWorkflowService(c);
                const workflowScheduleIds = list
                  .filter((s) => s.target.kind === "workflow")
                  .map((s) => s.id);
                const aggregated = await workflowService.aggregateByOrigin.execute({
                  origin: "schedule",
                  originIds: workflowScheduleIds,
                  statusIn: ["running"],
                });
                if (aggregated.isErr()) throw new Error(aggregated.error.type);
                return collectWorkflowFireStats(new Map(Object.entries(aggregated.value)));
              })()
            : undefined;
        return c.json(list.map((schedule) => projectScheduleHeader(schedule, workflowFireStats)));
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.list",
          policy: schedulesErrorPolicy,
        });
      }
    },
  );

  // ── POST /task — create a task-kind schedule ──────────────────────
  // URL-discriminated: the body carries no `target.kind` (the URL
  // declares it). Server narrows the validated wire shape to
  // `TaskTargetData` and forwards as `{ kind: "task", data: ... }`;
  // the registered task kind handler validates the shape again +
  // performs the async catalog existence lookup.
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
      const target: TaskTargetData = body.target;
      const trigger: ScheduleTrigger = body.trigger;
      try {
        const created = await resolve(c).create({
          name: body.name,
          trigger,
          target: { kind: "task", data: target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        logEvent(c, "schedule.create", {
          scheduleId: created.id,
          agent: target.agent,
        });
        return c.json(projectScheduleHeader(created), 201);
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.task.create",
          policy: schedulesErrorPolicy,
        });
      }
    },
  );

  // ── GET /preview-cron — preview an arbitrary (expr, tz) ──────────
  // Unscoped sibling of `/:sid/preview` for the "still being
  // authored" UI flow. Wraps `ScheduleService.preview`
  // directly — no entity lookup. MUST be registered BEFORE
  // `app.get('/:sid')` so the literal `preview-cron` path wins over
  // `:sid = "preview-cron"` param matching.
  //
  // Defaults: `n = 5` (matches the modal's preview count). Same
  // `[1, 100]` integer bound + strict parse as `/:sid/preview` so
  // `?n=1abc` is rejected (not silently accepted as `1`).
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
      // Modal default of 5; picked 5 over the /:sid/preview
      // default of 3 because the modal has more vertical space and
      // 5 fires is a clearer "what does this cron actually mean"
      // signal for the user.
      let n = 5;
      const nRaw = c.req.query("n");
      if (nRaw !== undefined) {
        const parsed = Number.parseInt(nRaw, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || `${parsed}` !== nRaw) {
          return c.json(errorBody(new ScheduleError("n must be an integer in [1, 100]")), 400);
        }
        n = parsed;
      }
      try {
        const preview = await resolve(c).preview({ expr, tz, n });
        return c.json(preview);
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.previewCron",
          policy: schedulesErrorPolicy,
        });
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
        const found = await resolve(c).get(sid);
        if (found === null) {
          // `ScheduleService.get` returns `Schedule | null`; project the
          // null branch into the same typed-error envelope every other
          // route uses, so callers can branch on `code`.
          const notFound = new ScheduleNotFoundError(sid);
          return c.json(errorBody(notFound), 404);
        }
        // Compute fireStats for workflow-kind schedules (spec: MUST on
        // both list and single-get endpoints).
        let workflowFireStats:
          | ReadonlyMap<string, NonNullable<ScheduleHeader["fireStats"]>>
          | undefined;
        if (found.target.kind === "workflow" && resolveWorkflowService !== undefined) {
          const workflowService = resolveWorkflowService(c);
          const aggregated = await workflowService.aggregateByOrigin.execute({
            origin: "schedule",
            originIds: [found.id],
            statusIn: ["running"],
          });
          if (aggregated.isErr()) throw new Error(aggregated.error.type);
          workflowFireStats = collectWorkflowFireStats(new Map(Object.entries(aggregated.value)));
        }
        // Enrich with derived cron `describe` so dashboards / CLI `show`
        // can render the human-readable text without a second round-trip.
        // NOT persisted on the entity — `trigger.expr` is the single
        // source of truth.
        return c.json({
          ...projectScheduleHeader(found, workflowFireStats),
          describe: describeCron(found.trigger.expr),
        });
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.get",
          policy: schedulesErrorPolicy,
        });
      }
    },
  );

  // ── PATCH /task/:sid — patch a task-kind schedule ─────────────────
  // Body semantics (RFC 7396 deep-merge for `target`):
  //   - `name`, `enabled`           — scalar set if present
  //   - `trigger`                   — wholesale replace if present
  //                                   (small atomic shape)
  //   - `target.agent` / `brief`    — set if present; `null` rejected
  //                                   (required fields; omit to keep)
  //   - `target.details` / `runtime` — string sets; `null` deletes;
  //                                   absent keeps
  //   - `target.kind`               — rejected (URL discriminates)
  //
  // Returns 404 (with a generic `ScheduleNotFoundError` envelope) if
  // `:sid` exists but its `target.kind !== "task"` — the resource at
  // this kind-discriminated URL is logically absent and the wire
  // shape must not leak the actual kind.
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
      const target: TaskTargetPatch | undefined = body.target;
      const trigger: ScheduleTrigger | undefined = body.trigger;
      try {
        const updated = await resolve(c).patch(sid, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(target !== undefined ? { target: { patch: target } } : {}),
          expectedKind: "task",
        });
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json(projectScheduleHeader(updated));
      } catch (err) {
        if (err instanceof ScheduleKindMismatchError) {
          logEvent(c, "schedule.patch.kind_mismatch", {
            scheduleId: sid,
            expected: err.expected,
            actual: err.actual,
          });
          return c.json(errorBody(new ScheduleNotFoundError(sid)), 404);
        }
        return respondError(c, err, {
          route: "schedules.task.patch",
          policy: schedulesErrorPolicy,
        });
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
      const target: WorkflowTargetData = body.target;
      const trigger: ScheduleTrigger = body.trigger;
      try {
        const created = await resolve(c).create({
          name: body.name,
          trigger,
          target: { kind: "workflow", data: target },
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        logEvent(c, "schedule.create", {
          scheduleId: created.id,
          coordinatorAgent: target.coordinatorAgent,
        });
        return c.json(projectScheduleHeader(created), 201);
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.workflow.create",
          policy: schedulesErrorPolicy,
        });
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
      const target: WorkflowTargetPatch | undefined = body.target;
      const trigger: ScheduleTrigger | undefined = body.trigger;
      try {
        const updated = await resolve(c).patch(sid, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(trigger !== undefined ? { trigger } : {}),
          ...(target !== undefined ? { target: { patch: target } } : {}),
          expectedKind: "workflow",
        });
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json(projectScheduleHeader(updated));
      } catch (err) {
        if (err instanceof ScheduleKindMismatchError) {
          logEvent(c, "schedule.patch.kind_mismatch", {
            scheduleId: sid,
            expected: err.expected,
            actual: err.actual,
          });
          return c.json(errorBody(new ScheduleNotFoundError(sid)), 404);
        }
        return respondError(c, err, {
          route: "schedules.workflow.patch",
          policy: schedulesErrorPolicy,
        });
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
        const { deletedDispatchCount } = await resolve(c).delete(sid);
        logEvent(c, "schedule.delete", { scheduleId: sid, deletedDispatchCount });
        return c.json({ ok: true as const, deletedDispatchCount });
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.delete",
          policy: schedulesErrorPolicy,
        });
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
        const { dispatchId } = await resolve(c).run(sid);
        logEvent(c, "schedule.run", { scheduleId: sid, dispatchId });
        return c.json({ dispatchId });
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.run",
          policy: schedulesErrorPolicy,
        });
      }
    },
  );

  // ── GET /:sid/preview ─────────────────────────────────────────────
  // `?n=` is bounded in `[1, 100]` here AND inside
  // `ScheduleService.preview` — see the service for the second-layer
  // check. Out-of-range emits a typed 400 envelope (code:
  // `ScheduleError`) before the service is touched; in-range plumbs
  // straight through.
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
          return c.json(errorBody(new ScheduleError("n must be an integer in [1, 100]")), 400);
        }
        n = parsed;
      }
      try {
        const service = resolve(c);
        const entity = await service.get(sid);
        if (entity === null) {
          const notFound = new ScheduleNotFoundError(sid);
          return c.json(errorBody(notFound), 404);
        }
        const preview = await service.preview({
          expr: entity.trigger.expr,
          tz: entity.trigger.tz,
          n: n ?? 3,
        });
        return c.json(preview);
      } catch (err) {
        return respondError(c, err, {
          route: "schedules.preview",
          policy: schedulesErrorPolicy,
        });
      }
    },
  );

  return app;
}
