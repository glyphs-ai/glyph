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
import type { WorkflowService } from "@glyphs-ai/workflow";
// `ScheduleError` is used by both the `/:sid/preview` n-bound check
// and the new `/preview-cron` n-bound check for a typed
// envelope on rejection.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { schedulesErrorPolicy } from "./_error-policies/schedules.js";
import { createApiApp, errorResponse, jsonResponse } from "./_openapi.js";
import { respondError } from "./_respond-error.js";
import {
  errorBody,
  logEvent,
  parseJsonBody,
  type ValidationFail,
  type ValidationResult,
} from "./_shared.js";

type ScheduleServiceResolver = (c: import("hono").Context) => ScheduleService;
type WorkflowServiceResolver = (c: import("hono").Context) => WorkflowService;

const ALLOWED_TASK_CREATE_KEYS = new Set(["name", "target", "trigger", "enabled"]);
const ALLOWED_TASK_PATCH_KEYS = new Set(["name", "target", "trigger", "enabled"]);
const ALLOWED_TASK_TARGET_KEYS = new Set(["agent", "brief", "details", "runtime"]);

const ALLOWED_WORKFLOW_CREATE_KEYS = new Set(["name", "target", "trigger", "enabled"]);
const ALLOWED_WORKFLOW_PATCH_KEYS = new Set(["name", "target", "trigger", "enabled"]);
const ALLOWED_WORKFLOW_TARGET_KEYS = new Set(["coordinatorAgent", "brief", "details"]);

/**
 * Reject a schedule-target body that sets `kind`: the target's kind is
 * implied by the URL segment (`/task` vs `/workflow`), so honouring a
 * body `kind` would let the caller contradict the route. Returns a
 * {@link ValidationFail} to propagate, or `null` when the body is clean.
 */
function forbidUrlImpliedKind(
  obj: Record<string, unknown>,
  message: string,
): ValidationFail | null {
  return "kind" in obj ? { ok: false, error: message } : null;
}

/** Validate a raw value as a {@link TaskTargetData} for `POST /task`. */
function validateTaskTargetData(raw: unknown): ValidationResult<TaskTargetData> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "target must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  // `kind` is URL-implied; reject if the caller sends it to avoid
  // contradictions with the URL discriminator.
  const kindFail = forbidUrlImpliedKind(
    obj,
    "target.kind must not be set on POST /schedules/task (kind is implied by the URL)",
  );
  if (kindFail) return kindFail;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TASK_TARGET_KEYS.has(k)) {
      return { ok: false, error: `target has unknown key "${k}"` };
    }
  }
  const { agent, brief, details, runtime } = obj;
  if (typeof agent !== "string" || agent.trim().length === 0) {
    return { ok: false, error: "target.agent must be a non-empty string" };
  }
  if (typeof brief !== "string" || brief.trim().length === 0) {
    return { ok: false, error: "target.brief must be a non-empty string" };
  }
  if (brief.includes("\n") || brief.includes("\r")) {
    return {
      ok: false,
      error: "target.brief must be a single line — pass long content via target.details",
    };
  }
  if (brief.trim().length > 200) {
    return { ok: false, error: "target.brief must be at most 200 chars" };
  }
  if (details !== undefined && typeof details !== "string") {
    return { ok: false, error: "target.details, when set, must be a string" };
  }
  if (runtime !== undefined && (typeof runtime !== "string" || runtime.trim().length === 0)) {
    return { ok: false, error: "target.runtime, when set, must be a non-empty string" };
  }
  return {
    ok: true,
    value: {
      agent,
      brief,
      ...(details !== undefined ? { details } : {}),
      ...(runtime !== undefined ? { runtime } : {}),
    },
  };
}

/**
 * Validate a raw value as a {@link TaskTargetPatch} for
 * `PATCH /task/:sid`. RFC 7396 semantics: `null` on optional
 * `details`/`runtime` deletes; `null` on required `agent`/`brief` is
 * rejected with a clear 400.
 */
function validateTaskTargetPatch(raw: unknown): ValidationResult<TaskTargetPatch> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "target must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const kindFail = forbidUrlImpliedKind(
    obj,
    "target.kind must not be set on PATCH /schedules/task/:sid (kind is implied by the URL)",
  );
  if (kindFail) return kindFail;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TASK_TARGET_KEYS.has(k)) {
      return { ok: false, error: `target has unknown key "${k}"` };
    }
  }
  const patch: {
    agent?: string;
    brief?: string;
    details?: string | null;
    runtime?: string | null;
  } = {};
  if ("agent" in obj) {
    const v = obj.agent;
    if (v === null) {
      return { ok: false, error: "target.agent cannot be null (required field; omit to keep)" };
    }
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "target.agent must be a non-empty string" };
    }
    patch.agent = v;
  }
  if ("brief" in obj) {
    const v = obj.brief;
    if (v === null) {
      return { ok: false, error: "target.brief cannot be null (required field; omit to keep)" };
    }
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "target.brief must be a non-empty string" };
    }
    if (v.includes("\n") || v.includes("\r")) {
      return {
        ok: false,
        error: "target.brief must be a single line — pass long content via target.details",
      };
    }
    if (v.trim().length > 200) {
      return { ok: false, error: "target.brief must be at most 200 chars" };
    }
    patch.brief = v;
  }
  if ("details" in obj) {
    const v = obj.details;
    if (v === null) {
      patch.details = null;
    } else if (typeof v === "string") {
      patch.details = v;
    } else {
      return {
        ok: false,
        error: "target.details must be a string (set), null (delete), or omitted (keep)",
      };
    }
  }
  if ("runtime" in obj) {
    const v = obj.runtime;
    if (v === null) {
      patch.runtime = null;
    } else if (typeof v === "string" && v.trim().length > 0) {
      patch.runtime = v;
    } else {
      return {
        ok: false,
        error: "target.runtime must be a non-empty string (set), null (delete), or omitted (keep)",
      };
    }
  }
  return { ok: true, value: patch };
}

/** Validate a raw value as a full {@link ScheduleTrigger}. */
function validateTrigger(raw: unknown): ValidationResult<ScheduleTrigger> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "trigger must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== "cron") {
    return { ok: false, error: 'trigger.kind must be "cron"' };
  }
  if (typeof obj.expr !== "string" || obj.expr.trim().length === 0) {
    return { ok: false, error: "trigger.expr must be a non-empty string" };
  }
  if (typeof obj.tz !== "string" || obj.tz.trim().length === 0) {
    return { ok: false, error: "trigger.tz must be a non-empty string" };
  }
  return { ok: true, value: { kind: "cron", expr: obj.expr, tz: obj.tz } };
}

/** Validate a raw value as a {@link WorkflowTargetData} for `POST /workflow`. */
function validateWorkflowTargetData(raw: unknown): ValidationResult<WorkflowTargetData> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "target must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const kindFail = forbidUrlImpliedKind(
    obj,
    "target.kind must not be set on POST /schedules/workflow (kind is implied by the URL)",
  );
  if (kindFail) return kindFail;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_WORKFLOW_TARGET_KEYS.has(k)) {
      return { ok: false, error: `target has unknown key "${k}"` };
    }
  }
  const { coordinatorAgent, brief, details } = obj;
  if (typeof coordinatorAgent !== "string" || coordinatorAgent.trim().length === 0) {
    return { ok: false, error: "target.coordinatorAgent must be a non-empty string" };
  }
  if (typeof brief !== "string" || brief.trim().length === 0) {
    return { ok: false, error: "target.brief must be a non-empty string" };
  }
  if (brief.includes("\n") || brief.includes("\r")) {
    return {
      ok: false,
      error: "target.brief must be a single line — pass long content via target.details",
    };
  }
  if (brief.trim().length > 200) {
    return { ok: false, error: "target.brief must be at most 200 chars" };
  }
  if (details !== undefined && typeof details !== "string") {
    return { ok: false, error: "target.details, when set, must be a string" };
  }
  return {
    ok: true,
    value: {
      coordinatorAgent,
      brief,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Validate a raw value as a {@link WorkflowTargetPatch} for
 * `PATCH /workflow/:sid`. RFC 7396 semantics: `null` on optional
 * `details` deletes; `null` on required `coordinatorAgent`/`brief` is
 * rejected with a clear 400.
 */
function validateWorkflowTargetPatch(raw: unknown): ValidationResult<WorkflowTargetPatch> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "target must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const kindFail = forbidUrlImpliedKind(
    obj,
    "target.kind must not be set on PATCH /schedules/workflow/:sid (kind is implied by the URL)",
  );
  if (kindFail) return kindFail;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_WORKFLOW_TARGET_KEYS.has(k)) {
      return { ok: false, error: `target has unknown key "${k}"` };
    }
  }
  const patch: {
    coordinatorAgent?: string;
    brief?: string;
    details?: string | null;
  } = {};
  if ("coordinatorAgent" in obj) {
    const v = obj.coordinatorAgent;
    if (v === null) {
      return {
        ok: false,
        error: "target.coordinatorAgent cannot be null (required field; omit to keep)",
      };
    }
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "target.coordinatorAgent must be a non-empty string" };
    }
    patch.coordinatorAgent = v;
  }
  if ("brief" in obj) {
    const v = obj.brief;
    if (v === null) {
      return { ok: false, error: "target.brief cannot be null (required field; omit to keep)" };
    }
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "target.brief must be a non-empty string" };
    }
    if (v.includes("\n") || v.includes("\r")) {
      return {
        ok: false,
        error: "target.brief must be a single line — pass long content via target.details",
      };
    }
    if (v.trim().length > 200) {
      return { ok: false, error: "target.brief must be at most 200 chars" };
    }
    patch.brief = v;
  }
  if ("details" in obj) {
    const v = obj.details;
    if (v === null) {
      patch.details = null;
    } else if (typeof v === "string") {
      patch.details = v;
    } else {
      return {
        ok: false,
        error: "target.details must be a string (set), null (delete), or omitted (keep)",
      };
    }
  }
  return { ok: true, value: patch };
}

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
                const aggregated = await workflowService.aggregateByOriginMetadataKey({
                  origin: "schedule",
                  metadataKey: "scheduleId",
                  metadataValues: workflowScheduleIds,
                  statusIn: ["running"],
                });
                return collectWorkflowFireStats(aggregated);
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
      responses: {
        201: jsonResponse(ScheduleHeaderSchema, "Created schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const parsed = await parseJsonBody<Record<string, unknown>>(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "request body must be an object" }, 400);
      }
      for (const k of Object.keys(body)) {
        if (!ALLOWED_TASK_CREATE_KEYS.has(k)) {
          return c.json({ error: `request body has unknown key "${k}"` }, 400);
        }
      }
      const { name, target, trigger, enabled } = body;

      if (typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "name must be a non-empty string" }, 400);
      }
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return c.json({ error: "enabled, when set, must be a boolean" }, 400);
      }
      const targetResult = validateTaskTargetData(target);
      if (!targetResult.ok) return c.json({ error: targetResult.error }, 400);
      const triggerResult = validateTrigger(trigger);
      if (!triggerResult.ok) return c.json({ error: triggerResult.error }, 400);

      try {
        const created = await resolve(c).create({
          name,
          trigger: triggerResult.value,
          target: { kind: "task", data: targetResult.value },
          ...(enabled !== undefined ? { enabled } : {}),
        });
        logEvent(c, "schedule.create", {
          scheduleId: created.id,
          agent: targetResult.value.agent,
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
          const aggregated = await workflowService.aggregateByOriginMetadataKey({
            origin: "schedule",
            metadataKey: "scheduleId",
            metadataValues: [found.id],
            statusIn: ["running"],
          });
          workflowFireStats = collectWorkflowFireStats(aggregated);
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
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(ScheduleHeaderSchema, "Updated schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const parsed = await parseJsonBody<Record<string, unknown>>(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "request body must be an object" }, 400);
      }
      for (const k of Object.keys(body)) {
        if (!ALLOWED_TASK_PATCH_KEYS.has(k)) {
          return c.json({ error: `request body has unknown key "${k}"` }, 400);
        }
      }

      const patch: {
        name?: string;
        enabled?: boolean;
        trigger?: ScheduleTrigger;
        target?: TaskTargetPatch;
      } = {};

      if ("name" in body) {
        const v = body.name;
        if (typeof v !== "string" || v.trim().length === 0) {
          return c.json({ error: "name must be a non-empty string" }, 400);
        }
        patch.name = v;
      }
      if ("enabled" in body) {
        const v = body.enabled;
        if (typeof v !== "boolean") {
          return c.json({ error: "enabled must be a boolean" }, 400);
        }
        patch.enabled = v;
      }
      if ("trigger" in body) {
        const r = validateTrigger(body.trigger);
        if (!r.ok) return c.json({ error: r.error }, 400);
        patch.trigger = r.value;
      }
      if ("target" in body) {
        const r = validateTaskTargetPatch(body.target);
        if (!r.ok) return c.json({ error: r.error }, 400);
        patch.target = r.value;
      }

      try {
        // `expectedKind: "task"` lets the service throw
        // `ScheduleKindMismatchError` (rather than blindly merging into
        // a non-task envelope) when `:sid` resolves to a schedule of a
        // different kind. We project the mismatch to a generic
        // `ScheduleNotFoundError` envelope below so the wire shape
        // doesn't leak the actual kind to the client.
        const updated = await resolve(c).patch(sid, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
          ...(patch.target !== undefined ? { target: { patch: patch.target } } : {}),
          expectedKind: "task",
        });
        logEvent(c, "schedule.patch", { scheduleId: sid });
        return c.json(projectScheduleHeader(updated));
      } catch (err) {
        // Project `ScheduleKindMismatchError` to the standard
        // `ScheduleNotFoundError` envelope so the wire shape does not
        // leak whether the schedule exists under another kind. The
        // server log still carries the original error for debugging.
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
      responses: {
        201: jsonResponse(ScheduleHeaderSchema, "Created schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Coordinator agent not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const parsed = await parseJsonBody<Record<string, unknown>>(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "request body must be an object" }, 400);
      }
      for (const k of Object.keys(body)) {
        if (!ALLOWED_WORKFLOW_CREATE_KEYS.has(k)) {
          return c.json({ error: `request body has unknown key "${k}"` }, 400);
        }
      }
      const { name, target, trigger, enabled } = body;

      if (typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "name must be a non-empty string" }, 400);
      }
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return c.json({ error: "enabled, when set, must be a boolean" }, 400);
      }
      const targetResult = validateWorkflowTargetData(target);
      if (!targetResult.ok) return c.json({ error: targetResult.error }, 400);
      const triggerResult = validateTrigger(trigger);
      if (!triggerResult.ok) return c.json({ error: triggerResult.error }, 400);

      try {
        const created = await resolve(c).create({
          name,
          trigger: triggerResult.value,
          target: { kind: "workflow", data: targetResult.value },
          ...(enabled !== undefined ? { enabled } : {}),
        });
        logEvent(c, "schedule.create", {
          scheduleId: created.id,
          coordinatorAgent: targetResult.value.coordinatorAgent,
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
      request: { params: z.object({ sid: z.string() }) },
      responses: {
        200: jsonResponse(ScheduleHeaderSchema, "Updated schedule"),
        400: errorResponse("Malformed request body"),
        404: errorResponse("Schedule not found"),
        500: errorResponse("Internal error"),
      },
    }),
    async (c) => {
      const sid = c.req.param("sid");
      const parsed = await parseJsonBody<Record<string, unknown>>(c);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const body = parsed.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "request body must be an object" }, 400);
      }
      for (const k of Object.keys(body)) {
        if (!ALLOWED_WORKFLOW_PATCH_KEYS.has(k)) {
          return c.json({ error: `request body has unknown key "${k}"` }, 400);
        }
      }

      const patch: {
        name?: string;
        enabled?: boolean;
        trigger?: ScheduleTrigger;
        target?: WorkflowTargetPatch;
      } = {};

      if ("name" in body) {
        const v = body.name;
        if (typeof v !== "string" || v.trim().length === 0) {
          return c.json({ error: "name must be a non-empty string" }, 400);
        }
        patch.name = v;
      }
      if ("enabled" in body) {
        const v = body.enabled;
        if (typeof v !== "boolean") {
          return c.json({ error: "enabled must be a boolean" }, 400);
        }
        patch.enabled = v;
      }
      if ("trigger" in body) {
        const r = validateTrigger(body.trigger);
        if (!r.ok) return c.json({ error: r.error }, 400);
        patch.trigger = r.value;
      }
      if ("target" in body) {
        const r = validateWorkflowTargetPatch(body.target);
        if (!r.ok) return c.json({ error: r.error }, 400);
        patch.target = r.value;
      }

      try {
        const updated = await resolve(c).patch(sid, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
          ...(patch.target !== undefined ? { target: { patch: patch.target } } : {}),
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
