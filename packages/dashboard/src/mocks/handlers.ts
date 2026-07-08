/**
 * MSW request handlers for the dashboard's API surface.
 *
 * Every URL here mirrors a fetch call site in `packages/dashboard/src/api/`.
 * When adding a new dashboard route, mirror it here too (or add a fixture
 * entry the catch-all can serve) — otherwise designer mode will pass the
 * request through to the (non-existent) backend and log an
 * `onUnhandledRequest: "warn"` warning in the browser console.
 *
 * The handlers are read-only plus the mutation routes needed by designer
 * mode. The catch-all returns 501 for any non-GET mutation that doesn't
 * match a handler above it.
 */

import { type DefaultBodyType, HttpResponse, http } from "msw";
import type { AgentEntry, Mcp, SkillEntry } from "../api/catalog.js";
import type {
  CreateWorkflowRequest,
  ScheduleDetail,
  ScheduleView,
  SessionView,
  TaskRecord,
  WorkflowHeader,
  WorkflowNode,
} from "../api/index.js";
import type {
  CreateTaskScheduleRequest,
  CreateWorkflowScheduleRequest,
  PatchTaskScheduleRequest,
  PatchWorkflowScheduleRequest,
  TaskScheduleTarget,
} from "../api/schedules.js";
import {
  artifactBodies,
  fixtureActiveWorkspaceId,
  fixtureActivities,
  fixtureSchedules,
  fixtureWorkflowArtifacts,
  fixtureWorkflowDags,
  fixtureWorkflows,
  fixtureWorkspaces,
} from "./fixtures/index.js";
import { store } from "./store.js";

const W = ":workspaceId";

/**
 * Assemble a Problem-details body for the mock error paths so designer
 * mode and dashboard tests see the same `application/problem+json` envelope
 * the real server emits: `{ type, title, status, detail, code, ...ext }`.
 * Accepts the legacy `{ error, code?, ... }` shape used at the call sites and
 * reshapes `error` → `detail`, filling `type`/`title`/`code` defaults. The
 * `title` is humanized from the code the same way the server's fallback does
 * (`packages/api/src/_http-errors.ts` `humanizeCode`), so the mock envelope
 * reads like the real one instead of echoing the raw `code`.
 */
function humanizeProblemCode(code: string): string {
  const stem = code.endsWith("Error") ? code.slice(0, -5) : code;
  const spaced = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (spaced === "") return "Error";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function mockProblem(
  status: number,
  body: { error?: string; detail?: string; code?: string; field?: string } & Record<
    string,
    unknown
  >,
): HttpResponse<DefaultBodyType> {
  const { error, detail, code, ...rest } = body;
  const resolvedCode =
    code ??
    (status >= 500
      ? "InternalError"
      : status === 404
        ? "NotFound"
        : status === 409
          ? "Conflict"
          : "BadRequest");
  const kebab = resolvedCode.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return HttpResponse.json(
    {
      type: `https://errors.glyph.ai/${kebab}`,
      title: humanizeProblemCode(resolvedCode),
      status,
      detail: detail ?? error ?? "",
      code: resolvedCode,
      ...rest,
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

function notFound(message: string): HttpResponse<DefaultBodyType> {
  return mockProblem(404, { error: message });
}

/**
 * Ephemeral, in-memory copy of the schedule fixtures so PATCH /
 * DELETE / POST run mutate this slot without polluting the
 * source-of-truth fixture array. A browser refresh re-imports this
 * module and resets the slot — designer mode is intentionally
 * non-persistent (designer iteration ≠ a real backend).
 */
const schedulesState: ScheduleDetail[] = fixtureSchedules.map((s) => ({ ...s }));

let synthFireSeq = 0;

/**
 * Ephemeral workflow mutation slice. Header rows live in
 * `workflowsState`, DAGs in `dagsState` keyed by workflow id. Both
 * reset on browser refresh — designer mode is non-persistent. Headers
 * are stored as mutable copies of the readonly fixtures so the cancel
 * handler can flip status / endedAt in place. The DAG shape uses a
 * local mutable mirror of the wire type so the cancel handler can
 * re-attach the updated header and re-write the node array without
 * colliding with the wire-type's `readonly` modifiers.
 */
interface MutableWorkflowDag {
  workflow: WorkflowHeader;
  nodes: WorkflowNode[];
  edges: { from: string; to: string; workflowId: string }[];
}

const workflowsState: WorkflowHeader[] = fixtureWorkflows.map((w) => ({ ...w }));
const dagsState: Map<string, MutableWorkflowDag> = new Map(
  Array.from(fixtureWorkflowDags.entries()).map(([id, dag]) => [
    id,
    {
      workflow: { ...dag.workflow },
      nodes: dag.nodes.map((n) => ({ ...n })),
      edges: dag.edges.map((e) => ({ ...e })),
    },
  ]),
);

/**
 * Short, deterministic-enough random id helper for synthesised
 * schedule entities (mock mode only). `crypto.randomUUID()` exists in
 * every modern browser; we slice 8 hex chars off the start for a
 * compact-looking sched id (`sched-1a2b3c4d`). Tests that need a
 * stable id can still set their own fixture and avoid the POST path.
 */
function cryptoRandom8(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(16).slice(2)}-x`).slice(
    0,
    8,
  );
}

/**
 * Full UUIDv4 for mock workflow node ids. Node ids must satisfy
 * `assertValidWorkflowNodeId`'s UUIDv4 grammar — the 8-char slice
 * produced by `cryptoRandom8` would throw at the substrate layer.
 * Falls back to a hand-shaped UUIDv4-like string when `crypto.randomUUID`
 * is absent (older test runners) so the mock still satisfies the
 * UUIDv4 regex.
 */
function cryptoUuid(): string {
  const u = globalThis.crypto?.randomUUID?.();
  if (u !== undefined) return u;
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  // y in [8,9,a,b]: the v4 UUID variant nibble (top two bits fixed to 10)
  const y = "89ab"[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${y}${hex(3)}-${hex(12)}`;
}

/**
 * Derive a plausible FQN from an origin URL for mock install handlers.
 * Extracts the last two path segments (namespace/short) or falls back
 * to `mock-<kind>/<random>`.
 */
function deriveFqnFromOrigin(origin: string, kind: string): string {
  try {
    const parts = new URL(origin).pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  } catch {
    // Not a valid URL — fall through
  }
  // file: or unparseable origins
  const segments = origin
    .replace(/^file:/, "")
    .split(/[/\\]/)
    .filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return `mock-${kind}/${cryptoRandom8()}`;
}

export const handlers = [
  // ── catalog (workspace-scoped) ───────────────────────────────
  http.get(`/api/workspaces/${W}/catalog/overview`, () =>
    HttpResponse.json({
      counts: {
        skills: store.skills.length,
        agents: store.agents.length,
        mcps: store.mcps.length,
        blocked: store.agents.filter((a) => a.status === "blocked").length,
        orphaned: 0,
      },
    }),
  ),
  http.get(`/api/workspaces/${W}/catalog/agents`, () => HttpResponse.json(store.agents)),
  http.get(`/api/workspaces/${W}/catalog/skills`, () => HttpResponse.json(store.skills)),
  http.get(`/api/workspaces/${W}/catalog/mcps`, () => HttpResponse.json(store.mcps)),

  // ── tasks (workspace-scoped) ─────────────────────────────────
  // `/tasks` is standalone-only; `/scheduled-tasks` carries
  // schedule-launched runs. Both routes share this fixture set with
  // origin-based filtering.
  http.get(`/api/workspaces/${W}/tasks`, () =>
    HttpResponse.json(store.tasks.filter((t) => t.origin === "standalone")),
  ),
  http.get(`/api/workspaces/${W}/scheduled-tasks`, ({ request }) => {
    const url = new URL(request.url);
    const scheduleId = url.searchParams.get("scheduleId");
    let rows = store.tasks.filter((t) => t.origin === "schedule");
    if (scheduleId !== null) {
      rows = rows.filter((t) => t.originId === scheduleId);
    }
    return HttpResponse.json(rows);
  }),
  // `/scheduled-workflows` is the workflow-kind sibling of
  // `/scheduled-tasks`: it carries the workflow runs a schedule has
  // launched, surfaced by the schedule detail's "Recent fires" panel
  // for workflow-kind schedules. "schedule-launched" is identified by
  // the typed `originId` (set when `origin === "schedule"`).
  http.get(`/api/workspaces/${W}/scheduled-workflows`, ({ request }) => {
    const url = new URL(request.url);
    const scheduleId = url.searchParams.get("scheduleId");
    const rows = workflowsState.filter((w) => {
      if (typeof w.originId !== "string") return false;
      return scheduleId === null || w.originId === scheduleId;
    });
    return HttpResponse.json(rows);
  }),
  http.get(`/api/workspaces/${W}/tasks/:taskId`, ({ params }) => {
    const task = store.tasks.find((t) => t.id === params.taskId);
    return task ? HttpResponse.json(task) : notFound("task not found");
  }),
  http.get(`/api/workspaces/${W}/tasks/:taskId/activity`, ({ params }) => {
    const taskId = String(params.taskId);
    const activity = fixtureActivities[taskId];
    if (activity) return HttpResponse.json(activity);
    // Tasks without a hand-authored timeline still return a valid empty
    // payload — the dashboard's ActivityTab handles { activity: [] }
    // gracefully, but treats 404 as "runtime has no event log".
    if (store.tasks.some((t) => t.id === taskId)) {
      return HttpResponse.json({ activity: [], result: null, totalItems: 0 });
    }
    return new HttpResponse(null, { status: 404 });
  }),
  http.get(`/api/workspaces/${W}/tasks/:taskId/artifact`, ({ params, request }) => {
    const relPath = new URL(request.url).searchParams.get("path") ?? "";
    const key = `${params.taskId}/${relPath}`;
    const entry = artifactBodies.get(key);
    if (!entry) return new HttpResponse(null, { status: 404 });
    return new HttpResponse(entry.body, {
      headers: { "content-type": entry.contentType },
    });
  }),

  // ── sessions (workspace-scoped) ──────────────────────────────
  http.get(`/api/workspaces/${W}/sessions`, () => HttpResponse.json(store.sessions)),
  http.get(`/api/workspaces/${W}/sessions/:sessionId`, ({ params }) => {
    const sess = store.sessions.find((s) => s.id === params.sessionId);
    return sess ? HttpResponse.json(sess) : notFound("session not found");
  }),

  // ── workspaces + global metadata ─────────────────────────────
  http.get("/api/workspaces", () => HttpResponse.json(fixtureWorkspaces)),
  http.get("/api/workspaces/current", () => HttpResponse.json({ id: fixtureActiveWorkspaceId })),
  http.get("/api/runtimes", () =>
    HttpResponse.json([
      { kind: "copilot", capabilities: { remoteSession: true } },
      { kind: "claude", capabilities: {} },
    ]),
  ),
  http.get("/api/config", () =>
    HttpResponse.json({
      glyphHome: "/mock/glyph-home",
      currentWorkspaceId: fixtureActiveWorkspaceId,
      host: "localhost",
      port: 41817,
      pathSeparator: "/",
      tasks: { pollIntervalMs: 5000 },
    }),
  ),
  // /api/health is also where `server-clock.ts` reads `serverNow` from,
  // so this handler keeps "Today" / "7d" filter cutoffs working.
  http.get("/api/health", () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      status: "ok",
      name: "@glyphs-ai/server (mock)",
      version: "0.0.0-mock",
      startedAt: "2026-05-20T08:00:00.000Z",
      uptimeSec: 3600,
      serverNow: now,
    });
  }),

  // SSE stream for a running task. Emits a heartbeat then the `end`
  // sentinel and closes, so the SDK-backed stream connects, sees the
  // terminal boundary, and the `useReconnectingStream` hook stops without
  // entering its reconnect loop. Swap in `event: activity` frames (raw
  // `ActivityItem` JSON in `data:`) to exercise `mergeStreamItem`.
  http.get(`/api/workspaces/${W}/tasks/:taskId/activity/stream`, () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: heartbeat\ndata: {}\n\n"));
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
      },
    });
    return new HttpResponse(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }),

  // ── schedules (workspace-scoped) ──────────────
  // List + detail + preview are read-only; PATCH (enabled toggle),
  // DELETE, and POST /:scheduleId/run form the narrow mutation slice the
  // dashboard's detail surface drives. State lives in
  // `schedulesState` and resets on browser refresh.
  http.get(`/api/workspaces/${W}/schedules`, ({ request }) => {
    const url = new URL(request.url);
    const agent = url.searchParams.get("agent");
    const enabled = url.searchParams.get("enabled");
    let rows = schedulesState.slice();
    if (agent !== null) {
      rows = rows.filter((s) => {
        if (s.target.kind === "task") return (s.target as TaskScheduleTarget).agent === agent;
        if (s.target.kind === "workflow")
          return (s.target as { coordinatorAgent: string }).coordinatorAgent === agent;
        return false;
      });
    }
    if (enabled === "true") rows = rows.filter((s) => s.enabled);
    if (enabled === "false") rows = rows.filter((s) => !s.enabled);
    rows.sort((a, b) => (a.nextFireAt ?? "").localeCompare(b.nextFireAt ?? ""));
    // Strip `describe` from the list view to mirror the server's
    // `GET /` response shape (the describe enrichment is per-GET).
    return HttpResponse.json(rows.map(({ describe: _describe, ...rest }) => rest));
  }),
  // POST /schedules/task is where the dashboard's "New schedule"
  // modal lands. The URL discriminates `target.kind`: the body carries
  // no `target.kind`, and the mock injects `"task"` before
  // storing. Mirrors the server route's validation shape (name +
  // target with required agent/brief + trigger.kind=cron).
  // Synthesises ids, timestamps, and a hand-wavy describe — designer
  // mode is intentionally rough on the describe accuracy; cronstrue
  // is a server-side dep.
  http.post(`/api/workspaces/${W}/schedules/task`, async ({ request }) => {
    const body = (await request.json()) as CreateTaskScheduleRequest;
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return mockProblem(400, { error: "name must be a non-empty string" });
    }
    if (
      body.target === undefined ||
      body.target === null ||
      typeof body.target.agent !== "string" ||
      typeof body.target.brief !== "string"
    ) {
      return mockProblem(400, { error: "target must be { agent, brief, details?, runtime? }" });
    }
    if (
      body.trigger === undefined ||
      body.trigger === null ||
      body.trigger.kind !== "cron" ||
      typeof body.trigger.expr !== "string" ||
      typeof body.trigger.tz !== "string"
    ) {
      return mockProblem(400, { error: "trigger must be { kind: 'cron', expr, tz }" });
    }
    const id = `sched-${cryptoRandom8()}`;
    const now = new Date().toISOString();
    const created: ScheduleDetail = {
      id,
      name: body.name.trim(),
      target: { kind: "task", ...body.target },
      trigger: body.trigger,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      nextFireAt: new Date(Date.now() + 60_000).toISOString(),
      lastFiredAt: undefined,
      describe: `Mock describe for ${body.trigger.expr}`,
    };
    schedulesState.unshift(created);
    // Server's POST returns 201 with the entity (no `describe` —
    // that's enriched only on GET /:scheduleId). Mirror exactly so the
    // wire shape lines up.
    const { describe: _describe, ...entity } = created;
    return HttpResponse.json(entity satisfies ScheduleView, { status: 201 });
  }),
  // POST /schedules/workflow is the workflow-kind sibling of
  // /schedules/task — the "New schedule" modal lands here when the
  // target-type switcher is set to "Workflow". The body carries a
  // workflow target (`coordinatorAgent` + `brief` + optional
  // `details`, no `runtime`); the mock injects `kind: "workflow"`
  // before storing. Mirrors the server route's validation shape.
  http.post(`/api/workspaces/${W}/schedules/workflow`, async ({ request }) => {
    const body = (await request.json()) as CreateWorkflowScheduleRequest;
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return mockProblem(400, { error: "name must be a non-empty string" });
    }
    if (
      body.target === undefined ||
      body.target === null ||
      typeof body.target.coordinatorAgent !== "string" ||
      typeof body.target.brief !== "string"
    ) {
      return mockProblem(400, { error: "target must be { coordinatorAgent, brief, details? }" });
    }
    if (
      body.trigger === undefined ||
      body.trigger === null ||
      body.trigger.kind !== "cron" ||
      typeof body.trigger.expr !== "string" ||
      typeof body.trigger.tz !== "string"
    ) {
      return mockProblem(400, { error: "trigger must be { kind: 'cron', expr, tz }" });
    }
    const id = `sched-${cryptoRandom8()}`;
    const now = new Date().toISOString();
    const created: ScheduleDetail = {
      id,
      name: body.name.trim(),
      target: {
        kind: "workflow",
        coordinatorAgent: body.target.coordinatorAgent,
        brief: body.target.brief,
        ...(typeof body.target.details === "string" && body.target.details.trim() !== ""
          ? { details: body.target.details }
          : {}),
      },
      trigger: body.trigger,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      nextFireAt: new Date(Date.now() + 60_000).toISOString(),
      lastFiredAt: undefined,
      describe: `Mock describe for ${body.trigger.expr}`,
      fireStats: { awaitingCount: 0, runningCount: 0 },
    } as ScheduleDetail;
    schedulesState.unshift(created);
    const { describe: _describe, ...entity } = created;
    return HttpResponse.json(entity satisfies ScheduleView, { status: 201 });
  }),
  // GET /schedules/preview-cron is the unscoped cron preview.
  // MUST come BEFORE the GET /:scheduleId handlers so MSW matches the
  // literal `preview-cron` path before the `:scheduleId` wildcard.
  // Designer mode synthesises hourly-spaced nextRuns; cronstrue is
  // not a dashboard dep, so describe is a hand-rolled passthrough.
  http.get(`/api/workspaces/${W}/schedules/preview-cron`, ({ request }) => {
    const u = new URL(request.url);
    const expr = u.searchParams.get("expr") ?? "";
    const tz = u.searchParams.get("tz") ?? "";
    if (!expr || !tz) {
      return mockProblem(400, { error: "expr+tz required" });
    }
    const rawN = u.searchParams.get("n");
    const n = Math.min(100, Math.max(1, Number.parseInt(rawN ?? "5", 10) || 5));
    const base = Date.now();
    const nextRuns = Array.from({ length: n }, (_, i) =>
      new Date(base + (i + 1) * 3_600_000).toISOString(),
    );
    return HttpResponse.json({ describe: `Mock describe for ${expr}`, nextRuns });
  }),
  http.get(`/api/workspaces/${W}/schedules/:scheduleId`, ({ params }) => {
    const row = schedulesState.find((s) => s.id === params.scheduleId);
    return row ? HttpResponse.json(row) : notFound("schedule not found");
  }),
  http.get(`/api/workspaces/${W}/schedules/:scheduleId/preview`, ({ params, request }) => {
    const row = schedulesState.find((s) => s.id === params.scheduleId);
    if (!row) return notFound("schedule not found");
    // Server enforces `[1, 100]`; mirror exactly so screenshots at the
    // boundary line up with prod behaviour.
    const nRaw = new URL(request.url).searchParams.get("n");
    const n = Math.min(100, Math.max(1, Number.parseInt(nRaw ?? "3", 10) || 3));
    const base = row.nextFireAt ? new Date(row.nextFireAt).getTime() : Date.now();
    const nextRuns = Array.from({ length: n }, (_, i) =>
      new Date(base + i * 3_600_000).toISOString(),
    );
    return HttpResponse.json({ describe: row.describe, nextRuns });
  }),
  // PATCH /schedules/task/:scheduleId is URL-discriminated by `target.kind`.
  // `target` uses deep-merge semantics: present
  // string sets, `null` deletes (`details` / `runtime`), absent keeps.
  // `trigger` is wholesale-replace; `name` / `enabled` are scalar-set.
  http.patch(`/api/workspaces/${W}/schedules/task/:scheduleId`, async ({ params, request }) => {
    const idx = schedulesState.findIndex((s) => s.id === params.scheduleId);
    if (idx === -1) return notFound("schedule not found");
    const body = (await request.json()) as PatchTaskScheduleRequest;
    const current = schedulesState[idx]!;
    let nextTarget = current.target;
    if (body.target !== undefined && current.target.kind === "task") {
      const ct = current.target as TaskScheduleTarget;
      const t = { ...ct };
      if (body.target.agent !== undefined) t.agent = body.target.agent;
      if (body.target.brief !== undefined) t.brief = body.target.brief;
      if (body.target.details === null) delete (t as { details?: string }).details;
      else if (body.target.details !== undefined) t.details = body.target.details;
      if (body.target.runtime === null) delete (t as { runtime?: string }).runtime;
      else if (body.target.runtime !== undefined) t.runtime = body.target.runtime;
      nextTarget = t;
    }
    const merged: ScheduleDetail = {
      ...current,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
      target: nextTarget,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      updatedAt: new Date().toISOString(),
    } as ScheduleDetail;
    schedulesState[idx] = merged;
    // Server's PATCH returns the entity without the describe enrichment
    // (re-derived only on GET); mirror that shape so the dashboard
    // doesn't get a stale describe baked into list rows.
    const { describe: _describe, ...entity } = merged;
    return HttpResponse.json(entity);
  }),
  // PATCH /schedules/workflow/:scheduleId is the workflow-kind sibling
  // of the task PATCH. `target` uses the same deep-merge
  // semantics (string sets, `null` deletes `details`, absent keeps),
  // but over the workflow target shape (`coordinatorAgent` + `brief` +
  // `details`, no `runtime`).
  http.patch(`/api/workspaces/${W}/schedules/workflow/:scheduleId`, async ({ params, request }) => {
    const idx = schedulesState.findIndex((s) => s.id === params.scheduleId);
    if (idx === -1) return notFound("schedule not found");
    const body = (await request.json()) as PatchWorkflowScheduleRequest;
    const current = schedulesState[idx]!;
    let nextTarget = current.target;
    if (body.target !== undefined && current.target.kind === "workflow") {
      const ct = current.target as {
        kind: "workflow";
        coordinatorAgent: string;
        brief: string;
        details?: string;
      };
      const t = { ...ct };
      if (body.target.coordinatorAgent !== undefined)
        t.coordinatorAgent = body.target.coordinatorAgent;
      if (body.target.brief !== undefined) t.brief = body.target.brief;
      if (body.target.details === null) delete (t as { details?: string }).details;
      else if (body.target.details !== undefined) t.details = body.target.details;
      nextTarget = t;
    }
    const merged: ScheduleDetail = {
      ...current,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
      target: nextTarget,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      updatedAt: new Date().toISOString(),
    } as ScheduleDetail;
    schedulesState[idx] = merged;
    const { describe: _describe, ...entity } = merged;
    return HttpResponse.json(entity);
  }),
  http.delete(`/api/workspaces/${W}/schedules/:scheduleId`, ({ params }) => {
    const idx = schedulesState.findIndex((s) => s.id === params.scheduleId);
    if (idx === -1) return notFound("schedule not found");
    schedulesState.splice(idx, 1);
    return HttpResponse.json({ ok: true, deletedDispatchCount: 0 });
  }),
  http.post(`/api/workspaces/${W}/schedules/:scheduleId/run`, ({ params }) => {
    const row = schedulesState.find((s) => s.id === params.scheduleId);
    if (!row) return notFound("schedule not found");
    synthFireSeq += 1;
    const firedAt = new Date().toISOString();
    // Workflow-kind schedules synthesise a freshly-running workflow
    // (header + single-coordinator DAG) tagged with the typed `originId`
    // so the detail surface's "Recent fires" panel (which polls
    // `/scheduled-workflows?scheduleId=…`) surfaces it, and clicking the
    // row swaps the right-pane into the workflow Mode B pane
    // (`FireWorkflowDetailPane`), which fetches the workflow + DAG by id.
    if (row.target.kind === "workflow") {
      const wfTarget = row.target as {
        kind: "workflow";
        coordinatorAgent: string;
        brief: string;
        details?: string;
      };
      const workflowId = `wf-${cryptoRandom8()}`;
      const created: WorkflowHeader = {
        id: workflowId,
        brief: `${row.name} (manual run)`,
        ...(typeof wfTarget.details === "string" && wfTarget.details.trim() !== ""
          ? { details: wfTarget.details }
          : {}),
        status: "running",
        origin: "schedule",
        originId: row.id,
        coordinatorAgent: wfTarget.coordinatorAgent,
        metadata: { firedAt },
        createdAt: firedAt,
        startedAt: firedAt,
      };
      workflowsState.unshift(created);
      const coordNode: WorkflowNode = {
        id: cryptoUuid(),
        workflowId,
        kind: "coordinator",
        status: "running",
        phase: 0,
        spec: { agent: wfTarget.coordinatorAgent },
        metadata: {},
        createdAt: firedAt,
        readyAt: firedAt,
        runningAt: firedAt,
      };
      dagsState.set(workflowId, { workflow: { ...created }, nodes: [coordNode], edges: [] });
      return HttpResponse.json({ dispatchId: workflowId });
    }
    // Task-kind: synthesise a freshly-running task so:
    //   1. the "Recent fires" panel (which polls
    //      `/scheduled-tasks?scheduleId=…`) surfaces it on the
    //      next refresh triggered by the parent's `refreshToken`
    //      bump after Run now;
    //   2. clicking the row swaps the right-pane into Mode B
    //      (`FireTaskDetailPane`), which fetches the task by id
    //      and renders it inside the schedules page (no
    //      cross-page navigation).
    const dispatchId = `sched-${row.id}-run-${synthFireSeq}`;
    const taskTarget = row.target.kind === "task" ? (row.target as TaskScheduleTarget) : null;
    const dispatchAgent = taskTarget?.agent ?? "";
    const dispatchRuntime = taskTarget?.runtime;
    store.tasks.unshift({
      id: dispatchId,
      agent: dispatchAgent,
      brief: `${row.name} (manual run)`,
      origin: "schedule",
      originId: row.id,
      status: "running",
      metadata: {
        workdir: `/mock/workspaces/designer/tasks/${dispatchId}`,
        ...(dispatchRuntime !== undefined ? { runtime: dispatchRuntime } : {}),
        firedAt,
      },
      createdAt: firedAt,
      startedAt: firedAt,
    });
    return HttpResponse.json({ dispatchId });
  }),

  // ── workflows (workspace-scoped) ─────────────────────────────
  // List + detail + DAG + create + cancel. Workflow rows live in
  // `workflowsState` and DAGs in `dagsState`; both reset on browser
  // refresh, same lifetime as `schedulesState`.
  http.get(`/api/workspaces/${W}/workflows`, ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const coordinatorAgent = url.searchParams.get("coordinatorAgent") ?? "";
    const createdSince = url.searchParams.get("createdSince") ?? "";
    let rows = workflowsState.slice();
    if (q !== "") rows = rows.filter((w) => w.id.includes(q));
    if (coordinatorAgent !== "") {
      rows = rows.filter((w) => w.coordinatorAgent === coordinatorAgent);
    }
    if (createdSince !== "") rows = rows.filter((w) => w.createdAt >= createdSince);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json(rows);
  }),
  http.post(`/api/workspaces/${W}/workflows`, async ({ request }) => {
    const body = (await request.json()) as CreateWorkflowRequest;
    if (typeof body.brief !== "string" || body.brief.trim() === "") {
      return mockProblem(400, { error: "brief must be a non-empty string" });
    }
    if (typeof body.coordinatorAgent !== "string" || body.coordinatorAgent.trim() === "") {
      return mockProblem(400, { error: "coordinatorAgent must be a non-empty agent FQN" });
    }
    const id = `wf-${cryptoRandom8()}`;
    const now = new Date().toISOString();
    const created: WorkflowHeader = {
      id,
      brief: body.brief.trim(),
      ...(typeof body.details === "string" && body.details.trim() !== ""
        ? { details: body.details }
        : {}),
      status: "running",
      origin: "standalone",
      coordinatorAgent: body.coordinatorAgent,
      metadata: {},
      createdAt: now,
      startedAt: now,
    };
    workflowsState.unshift(created);
    const coordNode: WorkflowNode = {
      id: cryptoUuid(),
      workflowId: id,
      kind: "coordinator",
      status: "running",
      phase: 0,
      spec: { agent: body.coordinatorAgent },
      metadata: {},
      createdAt: now,
      readyAt: now,
      runningAt: now,
    };
    dagsState.set(id, {
      workflow: { ...created },
      nodes: [coordNode],
      edges: [],
    });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(`/api/workspaces/${W}/workflows/:wfid`, ({ params }) => {
    const row = workflowsState.find((w) => w.id === params.wfid);
    return row ? HttpResponse.json(row) : notFound("workflow not found");
  }),
  http.get(`/api/workspaces/${W}/workflows/:wfid/dag`, ({ params }) => {
    const dag = dagsState.get(String(params.wfid));
    if (!dag) return notFound("workflow not found");
    const row = workflowsState.find((w) => w.id === params.wfid);
    if (row) dag.workflow = { ...row };
    return HttpResponse.json(dag);
  }),
  http.post(`/api/workspaces/${W}/workflows/:wfid/cancel`, async ({ params, request }) => {
    const idx = workflowsState.findIndex((w) => w.id === params.wfid);
    if (idx === -1) return notFound("workflow not found");
    const current = workflowsState[idx]!;
    if (current.status !== "running") {
      return mockProblem(409, {
        error: `workflow is already ${current.status}; cancel is a no-op`,
      });
    }
    // Wire shape: `{ cancellation: { kind?: 'user', message } }`. The
    // mock parses the message into the persisted `cancellation`
    // payload so the dashboard's optimistic re-render and the post-
    // cancel header show the operator-supplied reason.
    const body = (await request.json().catch(() => ({}))) as {
      cancellation?: { kind?: string; message?: string };
    };
    const message =
      typeof body?.cancellation?.message === "string" ? body.cancellation.message : "";
    const now = new Date().toISOString();
    const cancelled: WorkflowHeader = {
      ...current,
      status: "cancelled",
      endedAt: now,
      cancellation: { kind: "user", message },
    };
    workflowsState[idx] = cancelled;
    const dag = dagsState.get(cancelled.id);
    if (dag) {
      dag.workflow = { ...cancelled };
      dag.nodes = dag.nodes.map((n) =>
        n.status === "ready" || n.status === "running"
          ? {
              ...n,
              status: "cancelled",
              endedAt: now,
            }
          : n,
      );
    }
    return HttpResponse.json(cancelled);
  }),
  // ── Workflow artifacts (list + bytes) ────────────────────────────
  http.get(`/api/workspaces/${W}/workflows/:wfid/artifacts`, ({ params }) => {
    const wfid = String(params.wfid);
    if (!workflowsState.some((w) => w.id === wfid)) {
      return notFound("workflow not found");
    }
    const list = fixtureWorkflowArtifacts.get(wfid) ?? [];
    return HttpResponse.json({ artifacts: list });
  }),
  http.get(`/api/workspaces/${W}/workflows/:wfid/artifacts/:encodedPath`, ({ params }) => {
    const wfid = String(params.wfid);
    const encodedPath = String(params.encodedPath);
    let decoded: string;
    try {
      decoded = decodeURIComponent(encodedPath);
    } catch {
      return mockProblem(400, { error: "bad encoding" });
    }
    if (decoded.includes("..") || decoded.includes("\0")) {
      return mockProblem(400, { error: "traversal" });
    }
    // Designer mode serves a tiny stub blob keyed on extension so
    // the Artifacts tab can render markdown / image / generic
    // previews end-to-end without wiring real fixture bytes.
    const list = fixtureWorkflowArtifacts.get(wfid);
    const exists = (list ?? []).some((a) => {
      if (decoded.startsWith("summary/")) {
        return a.kind === "workflow-summary" && a.relPath === decoded.slice("summary/".length);
      }
      if (decoded.startsWith("nodes/")) {
        const tail = decoded.slice("nodes/".length);
        const sep = tail.indexOf("/");
        if (sep <= 0) return false;
        const nodeId = tail.slice(0, sep);
        const restPath = tail.slice(sep + 1);
        return a.kind === "node" && a.nodeId === nodeId && a.relPath === restPath;
      }
      return false;
    });
    if (!exists) return mockProblem(404, { error: "artifact not found" });
    const ext = decoded.slice(decoded.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "md") {
      return new HttpResponse(
        `# Designer mode placeholder\n\nWorkflow \`${wfid}\` artifact \`${decoded}\`.\n`,
        { headers: { "Content-Type": "text/markdown; charset=utf-8" } },
      );
    }
    if (ext === "html" || ext === "htm") {
      // Self-contained HTML stub (no external assets) so designer
      // mode exercises the workflow Artifacts tab's `<iframe srcdoc>`
      // path end-to-end — surfaces the C4 flex-height chain and
      // the C5 summary-first auto-select behavior without needing
      // a live coordinator run.
      return new HttpResponse(designerModeSummaryHtml(wfid, decoded), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
      // Same 1x1 transparent PNG (RFC-compliant) used for designer-mode previews.
      const pngBytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      return new HttpResponse(pngBytes, { headers: { "Content-Type": "image/png" } });
    }
    return new HttpResponse(`Designer-mode artifact stub: ${decoded}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }),

  // ── task mutations (workspace-scoped) ────────────────────────
  http.post(`/api/workspaces/${W}/tasks`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.agent !== "string" || body.agent.trim() === "") {
      return mockProblem(400, { error: "agent must be a non-empty string", code: "VALIDATION" });
    }
    if (typeof body.brief !== "string" || body.brief.trim() === "") {
      return mockProblem(400, { error: "brief must be a non-empty string", code: "VALIDATION" });
    }
    const now = new Date().toISOString();
    const id = `${now.slice(0, 10).replace(/-/g, "")}-${cryptoRandom8()}`;
    const task: TaskRecord = {
      id,
      agent: (body.agent as string).trim(),
      brief: (body.brief as string).trim(),
      ...(typeof body.details === "string" && body.details.trim() !== ""
        ? { details: body.details }
        : {}),
      origin: "standalone",
      status: "running",
      metadata: {
        workdir: `/mock/workspaces/designer/tasks/${id}`,
        ...(typeof body.runtime === "string" ? { runtime: body.runtime } : {}),
      },
      createdAt: now,
      startedAt: now,
    };
    store.tasks.unshift(task);
    return HttpResponse.json(task, { status: 201 });
  }),
  http.post(`/api/workspaces/${W}/tasks/:taskId/cancel`, ({ params }) => {
    const task = store.tasks.find((t) => t.id === params.taskId);
    if (!task) return notFound("task not found");
    if (task.status !== "running") {
      return mockProblem(409, {
        error: `task is already ${task.status}`,
        code: "InvalidTransition",
      });
    }
    const now = new Date().toISOString();
    task.status = "cancelled";
    task.endedAt = now;
    task.cancellation = { kind: "user", message: "Cancelled from the dashboard." };
    return HttpResponse.json(task);
  }),

  // ── session mutations (workspace-scoped) ─────────────────────
  http.post(`/api/workspaces/${W}/sessions`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.agent !== "string" || body.agent.trim() === "") {
      return mockProblem(400, { error: "agent must be a non-empty string", code: "VALIDATION" });
    }
    const now = new Date().toISOString();
    const id = `sess-${cryptoRandom8()}`;
    const session: SessionView = {
      id,
      workdir: `/mock/workspaces/designer/sessions/${id}`,
      agent: (body.agent as string).trim(),
      runtime: typeof body.runtime === "string" ? body.runtime : "copilot",
      runtimeSessionId: null,
      createdAt: now,
      lastActiveAt: null,
      preview: null,
      lastLaunchMode: null,
    };
    store.sessions.unshift(session);
    return HttpResponse.json(session, { status: 201 });
  }),

  // ── catalog mutations (workspace-scoped) ─────────────────────
  // Install agent
  http.post(`/api/workspaces/${W}/catalog/agents`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.origin !== "string" || body.origin.trim() === "") {
      return mockProblem(400, { error: "origin must be a non-empty string", code: "VALIDATION" });
    }
    const origin = (body.origin as string).trim();
    const fqn = deriveFqnFromOrigin(origin, "agent");
    const now = new Date().toISOString();
    const entry: AgentEntry = {
      agent: {
        fqn,
        origin,
        description: `Installed from ${origin}`,
        version: "1.0.0",
        prereqsAck: true,
        disabledByUser: false,
        installedAt: now,
        updatedAt: now,
      },
      status: "ready",
      coordEligible: false,
    };
    store.agents.push(entry as AgentEntry);
    return HttpResponse.json(
      { installed: [{ kind: "agent", fqn, prereqsAck: true }], skipped: [], failed: [] },
      { status: 201 },
    );
  }),
  // Uninstall agent
  http.delete(`/api/workspaces/${W}/catalog/agents/:scope/:name`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const idx = store.agents.findIndex((a) => a.agent.fqn === fqn);
    if (idx === -1) return notFound("agent not found");
    store.agents.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  // Install skill
  http.post(`/api/workspaces/${W}/catalog/skills`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.origin !== "string" || body.origin.trim() === "") {
      return mockProblem(400, { error: "origin must be a non-empty string", code: "VALIDATION" });
    }
    const origin = (body.origin as string).trim();
    const fqn = deriveFqnFromOrigin(origin, "skill");
    const now = new Date().toISOString();
    const entry: SkillEntry = {
      skill: {
        fqn,
        origin,
        description: `Installed from ${origin}`,
        version: "1.0.0",
        prereqsAck: true,
        orphaned: false,
        installedAt: now,
        updatedAt: now,
      },
      status: "ready",
    };
    store.skills.push(entry as SkillEntry);
    return HttpResponse.json(
      { installed: [{ kind: "skill", fqn, prereqsAck: true }], skipped: [], failed: [] },
      { status: 201 },
    );
  }),
  // Uninstall skill
  http.delete(`/api/workspaces/${W}/catalog/skills/:scope/:name`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const idx = store.skills.findIndex((s) => s.skill.fqn === fqn);
    if (idx === -1) return notFound("skill not found");
    store.skills.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  // Install mcp
  http.post(`/api/workspaces/${W}/catalog/mcps`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.origin !== "string" || body.origin.trim() === "") {
      return mockProblem(400, { error: "origin must be a non-empty string", code: "VALIDATION" });
    }
    const origin = (body.origin as string).trim();
    const fqn = deriveFqnFromOrigin(origin, "mcp");
    const now = new Date().toISOString();
    const entry: Mcp = {
      fqn,
      origin,
      orphaned: false,
      installedAt: now,
      updatedAt: now,
    };
    store.mcps.push(entry as Mcp);
    return HttpResponse.json(
      { installed: [{ kind: "mcp", fqn }], skipped: [], failed: [] },
      { status: 201 },
    );
  }),
  // Uninstall mcp
  http.delete(`/api/workspaces/${W}/catalog/mcps/:scope/:name`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const idx = store.mcps.findIndex((m) => m.fqn === fqn);
    if (idx === -1) return notFound("mcp not found");
    store.mcps.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  // Sync resolve (agents)
  http.post(`/api/workspaces/${W}/catalog/agents/:scope/:name/sync/resolve`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const entry = store.agents.find((a) => a.agent.fqn === fqn);
    if (!entry) return notFound("agent not found");
    return HttpResponse.json({
      rootOrigin: entry.agent.origin,
      rootFqn: fqn,
      isSync: true,
      upToDate: true,
      orphans: [],
      nodes: [
        {
          kind: "agent",
          origin: entry.agent.origin,
          fqn,
          shortName: fqn.split("/").pop() ?? fqn,
          scope: "public",
          status: "up-to-date",
          dependencyOrigins: [],
        },
      ],
    });
  }),
  // Sync apply (agents)
  http.post(`/api/workspaces/${W}/catalog/agents/:scope/:name/sync`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const entry = store.agents.find((a) => a.agent.fqn === fqn);
    if (!entry) return notFound("agent not found");
    return HttpResponse.json({
      installed: [],
      skipped: [{ kind: "agent", fqn, reason: "up-to-date" }],
      failed: [],
      orphansFlagged: [],
    });
  }),
  // Sync resolve (skills)
  http.post(`/api/workspaces/${W}/catalog/skills/:scope/:name/sync/resolve`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const entry = store.skills.find((s) => s.skill.fqn === fqn);
    if (!entry) return notFound("skill not found");
    return HttpResponse.json({
      rootOrigin: entry.skill.origin,
      rootFqn: fqn,
      isSync: true,
      upToDate: true,
      orphans: [],
      nodes: [
        {
          kind: "skill",
          origin: entry.skill.origin,
          fqn,
          shortName: fqn.split("/").pop() ?? fqn,
          scope: "public",
          status: "up-to-date",
          dependencyOrigins: [],
        },
      ],
    });
  }),
  // Sync apply (skills)
  http.post(`/api/workspaces/${W}/catalog/skills/:scope/:name/sync`, ({ params }) => {
    const fqn = `${params.scope}/${params.name}`;
    const entry = store.skills.find((s) => s.skill.fqn === fqn);
    if (!entry) return notFound("skill not found");
    return HttpResponse.json({
      installed: [],
      skipped: [{ kind: "skill", fqn, reason: "up-to-date" }],
      failed: [],
      orphansFlagged: [],
    });
  }),

  // ── catch-all: 501 mutations + pass-through unknown GETs ─────
  // GETs that no handler above matched fall through to MSW's
  // `onUnhandledRequest: "warn"` setting (configured in browser.ts),
  // which logs a console warning so designers see what's missing.
  http.all("/api/*", ({ request }) => {
    if (request.method !== "GET") {
      console.warn(`[mocks] ${request.method} ${request.url} — not mocked yet`);
      return HttpResponse.json(
        {
          error: "Mutation route not implemented in mock mode",
        },
        { status: 501 },
      );
    }
    return undefined;
  }),
];

/**
 * Designer-mode body for `.html` workflow artifacts: a self-
 * contained mock of the coordinator's summary report shape
 * (per `first-party/agents/coordinator/AGENTS.md` 0.1.2). No
 * external CSS / fonts / images / scripts — the body renders
 * fully inside the dashboard's `<iframe srcdoc>` viewer.
 */
function designerModeSummaryHtml(wfid: string, decoded: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Workflow ${wfid} — designer-mode summary</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 24px; max-width: 880px; }
  h1 { font-size: 1.4em; margin-top: 0; }
  h2 { font-size: 1.1em; margin-top: 1.6em; border-bottom: 1px solid #ccc8; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #ccc6; font-size: 0.95em; }
  th { background: #f0f0f01a; font-weight: 600; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.8em; background: #16a34a22; color: #15803d; }
  .muted { color: #6668; font-size: 0.85em; }
  code { background: #0001; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
  <h1>Designer-mode summary (<code>${decoded}</code>)</h1>
  <p class="muted">Workflow id: <code>${wfid}</code> &middot; this stub stands in for the real <code>summary.html</code> a coordinator agent would produce per <code>first-party/agents/coordinator/AGENTS.md</code> 0.1.2.</p>
  <p><strong>Outcome:</strong> <span class="badge">succeeded</span></p>

  <h2>Brief</h2>
  <p>Migrate package <code>@glyphs-ai/example</code> to async I/O. Engineer dispatches a single task, reviewer + designer verify, coordinator finishes.</p>

  <h2>Task tree</h2>
  <table>
    <thead><tr><th>Agent</th><th>Phase</th><th>Status</th><th>Task</th><th>Duration</th></tr></thead>
    <tbody>
      <tr><td>official/engineer</td><td>1</td><td>succeeded</td><td><code>20260608-aaaa1111</code></td><td>4m 32s</td></tr>
      <tr><td>official/reviewer</td><td>2</td><td>succeeded</td><td><code>20260608-bbbb2222</code></td><td>2m 11s</td></tr>
      <tr><td>official/designer</td><td>2</td><td>succeeded</td><td><code>20260608-cccc3333</code></td><td>3m 04s</td></tr>
    </tbody>
  </table>

  <h2>Reviewer verdict</h2>
  <blockquote><em>APPROVE</em> &mdash; no blocker or major findings; one minor cleanup noted in <code>review.md</code>.</blockquote>

  <h2>Designer verdict</h2>
  <blockquote><em>APPROVE</em> &mdash; visual + a11y probes pass at 1440&times;900 and 768&times;1024.</blockquote>

  <h2>Decisions</h2>
  <ul>
    <li>Phase 1 wake: engineer dispatched with the full brief.</li>
    <li>Phase 2 wake: reviewer + designer dispatched in parallel; both APPROVE.</li>
    <li>Phase 3 wake: <code>workflow finish --outcome succeeded</code>.</li>
  </ul>

  <h2>Per-node artifacts</h2>
  <ul>
    <li>Engineer: <code>PR #42 (placeholder)</code></li>
    <li>Reviewer: <code>verdict.json</code>, <code>review.md</code>, <code>artifact/reviewer-report.html</code></li>
    <li>Designer: <code>verdict.json</code>, <code>artifact/designer-report.html</code></li>
  </ul>
</body>
</html>`;
}
