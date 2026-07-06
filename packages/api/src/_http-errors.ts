import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "pino";
import { ZodError } from "zod";
import {
  PROBLEM_CONTENT_TYPE,
  type Problem,
  type ProblemIssue,
  toProblem,
  validationProblem,
} from "./schemas/problem.js";

/**
 * Allow-list of error class `name`s whose `.message` is safe to surface in
 * an HTTP response body. Each entry is a typed error from a glyph
 * package whose message is intentionally user-facing (no host paths, no
 * caller-controlled echoes, no Node `fs` error strings — kind / identifier
 * only).
 *
 * Anything outside this list — generic `Error`, `EACCES`/`ENOENT` from
 * the filesystem, syntax errors, third-party errors — collapses to a
 * generic "internal error" `detail` (with an opaque `InternalError` code)
 * to avoid leaking host paths or implementation details (e.g. `EACCES:
 * permission denied, open '/etc/shadow'`).
 *
 * Adding a new error class? Audit its `super(...)` template before
 * adding it here:
 *   - no absolute paths (`workdir`, `sessionDir`, `taskDir`, …)
 *   - no `cause.message` interpolated in (Node fs error strings,
 *     third-party stack lines)
 *   - no caller-controlled string echoed back without validation
 * Keep the diagnostic on the instance (public fields + `cause`) so the
 * route can `c.get("logger").error({ err, ... })` it;
 * just don't bake it into `.message`.
 */
export const SAFE_ERROR_NAMES = new Set<string>([
  // @glyphs-ai/api
  "WorkflowCoordAgentNotCapableError",
  "WorkflowCoordSpecError",
  "WorkflowHumanSpecError",
  "WorkflowWorkerSpecError",
  "WorkspaceHasLiveTasksError",
  "WorkspaceLoadError",
  // @glyphs-ai/catalog exposes DU errors; catalog route responses are
  // projected directly from the domain table rather than class names.
  // `AgentNotFoundError` is shared across session / schedule / task —
  // one allow-list entry covers all three. Each owning pkg audits its own
  // super(...) template for safety per the rules above.
  "AgentNotFoundError",
  // @glyphs-ai/session
  "InvalidSessionIdError",
  "SessionIdAllocationFailedError",
  "SessionNotFoundError",
  "SessionError",
  // @glyphs-ai/schedule
  "ScheduleError",
  "ScheduleNotFoundError",
  "InvalidScheduleIdError",
  "InvalidCronExprError",
  "InvalidTimezoneError",
  "InvalidJsonPathError",
  "ScheduleEnabledError",
  "ScheduleHasInFlightError",
  // @glyphs-ai/terminal (surface via /:id/spawn)
  "NoTerminalFoundError",
  "TerminalSpawnFailedError",
  "UnsupportedPlatformError",
  // @glyphs-ai/workspace
  //   Class-based: `WorkspaceHasLiveTasksError` + `WorkspaceLoadError`
  //   are api-owned (see workspace-context.ts) and surfaced as thrown
  //   classes — covered by the entries in the @glyphs-ai/api section.
  //   DU-based: `WorkspaceNotFound` / `WorkspacePathConflict` /
  //   `DatabaseUnavailable` /
  //   `ProvisioningFailed` flow through the workspace table,
  //   which builds the Problem directly from the DU `type` and
  //   bypasses this allow-list entirely.
  // @glyphs-ai/workflow
  "WorkflowError",
  "WorkflowNotFoundError",
  "WorkflowNodeNotFoundError",
  "InvalidWorkflowIdError",
  "InvalidWorkflowNodeIdError",
  "EmptyParentsError",
  "WorkflowAlreadyTerminalError",
  "WorkflowNodeNotMutableError",
  "WorkflowNodeSpecError",
  "WorkflowDagConflictError",
  "WorkflowSubgraphInvalidError",
]);

type LoggerContext = Context<{ Variables: { logger?: Logger } }>;

/**
 * Log a server-side fault via the request-scoped logger. The line lands
 * in the rotated JSON file (`<glyphHome>/logs/server-*.log`) via pino,
 * keeping file and stderr diagnostics aligned.
 *
 * Reads `c.var.logger` (set by `requestLogger` middleware) and falls
 * through silently when no logger is on the context (e.g. tests that
 * mount routes standalone). Returns void.
 *
 * `respondProblem` calls this for both the "5xx fault" and "unmapped error
 * fell through" structured log entries.
 */
export function logFault(
  c: Context,
  err: unknown,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const logger = (c as LoggerContext).get("logger");
  if (logger === undefined) return;
  logger.error({ err, ...(extra ?? {}) }, msg);
}

/**
 * Companion to {@link logFault} for state-mutating routes' success
 * boundary. Emits a single `info`-level structured line via the
 * request-scoped logger so operators can `jq 'select(.msg=="...")'`
 * audit who changed what.
 *
 * Same context-probe pattern as `logFault` (silent no-op when no
 * logger is on `c.var`, e.g. unit tests that mount a route factory
 * directly without the middleware chain). Routes typically call this
 * AFTER the manager call returns and BEFORE the JSON response is
 * built, so a 5xx in serialisation still leaves the audit line.
 *
 * Convention for `meta`: include the entity id (`sessionId` /
 * `taskId` / `workspaceId` / `fqn`), the action verb if the message
 * doesn't already carry it, and any user-supplied input that's safe
 * to log (NEVER request bodies / passwords / tokens — keep it to
 * structured fields the entity already exposes).
 */
export function logEvent(c: Context, msg: string, meta?: Record<string, unknown>): void {
  const logger = (c as LoggerContext).get("logger");
  if (logger === undefined) return;
  logger.info(meta ?? {}, msg);
}

/**
 * Shared meta builder for the "unmapped fell through" log entry. Pulls
 * the unknown error's `name` and `message` onto the structured log line
 * (in addition to the full `err` serialiser pino already attaches via
 * `logFault`) so the operator can `jq` for unmapped error classes without
 * parsing every nested `err.type`.
 *
 * Consumed by `respondProblem`; routes never call this directly.
 */
export function unmappedFaultMeta(
  err: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const e = err instanceof Error ? err : undefined;
  return {
    name: e?.name,
    message: e?.message,
    ...(extra ?? {}),
  };
}

/**
 * One row of a {@link ProblemTable}: the HTTP status + fixed `title` for a
 * `code`, plus optional builders for the per-occurrence `detail` string
 * and the extension members (`agent`, `reason`, `transition`, …).
 *
 * `title` is the RFC 9457 problem-type summary — stable across
 * occurrences. `detail` is the occurrence-specific message (today's
 * flattened error string). `extension` carries the atom-specific fields
 * the CLI / dashboard branch on. Both builders receive the route `opts`
 * so route-dependent bodies (e.g. `InvalidTransition`'s `transition`
 * verb) can read `opts.transition`.
 */
export interface ProblemDef {
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly detail?: (err: never, opts: RespondProblemOpts) => string;
  readonly extension?: (
    err: never,
    opts: RespondProblemOpts,
  ) => Record<string, unknown> | undefined;
}

/**
 * A per-domain error table: `code → {status, title, detail?, extension?}`.
 * Replaces the old twin `STATUS_BY_TYPE` + `MESSAGE_BY_TYPE` maps with a
 * single composite lookup. Each domain (tasks / sessions / workspaces /
 * schedules / workflows / catalog) owns its own table so same-named codes
 * from different domains map independently.
 */
export type ProblemTable = Readonly<Record<string, ProblemDef>>;

/**
 * Typed builder for a discriminated-union domain table. Maps every member
 * of the union `E` (keyed by its `.type`) to a row whose `detail` /
 * `extension` builders are narrowed to that exact member — so a row can
 * read member-specific fields (`err.agent`, `err.from`, …) without a cast.
 * The resulting object is assignable to {@link ProblemTable} because the
 * builders' member param is contravariantly compatible with `ProblemDef`'s
 * `never`.
 */
export type DomainProblemTable<E extends { type: string }> = {
  readonly [K in E["type"]]: {
    readonly status: ContentfulStatusCode;
    readonly title: string;
    readonly detail?: (err: Extract<E, { type: K }>, opts: RespondProblemOpts) => string;
    readonly extension?: (
      err: Extract<E, { type: K }>,
      opts: RespondProblemOpts,
    ) => Record<string, unknown> | undefined;
  };
};

export interface RespondProblemOpts {
  /**
   * Route label that lands on the structured log line, e.g.
   * `"tasks.cancel"` / `"sessions.create"`. Used as the message prefix
   * for both the "5xx fault" and "unmapped error fell through" log
   * entries so operators can grep by route.
   */
  readonly route: string;
  /**
   * Extra meta fields to attach to the structured log line
   * (`taskId`, `sessionId`, etc.). Forwarded verbatim to
   * {@link logFault}; included in `unmappedFaultMeta` when the error
   * is unmapped.
   */
  readonly meta?: Record<string, unknown>;
  /**
   * Status used when no table row matches the error (and it is not a
   * safe class error). Defaults to 400.
   */
  readonly defaultStatus?: ContentfulStatusCode;
  /** Route-supplied verb for `InvalidTransition`-style bodies (`"cancel"` / `"delete"`). */
  readonly transition?: string;
}

/**
 * Resolve an error `code` from a value: DU `.code` / `.type` first, then
 * an `Error` instance's class `.name` (so class-based errors match a
 * table row keyed by their name).
 */
export function readErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const rec = err as { code?: unknown; type?: unknown };
    if (typeof rec.code === "string") return rec.code;
    if (typeof rec.type === "string") return rec.type;
  }
  if (err instanceof Error) return err.name;
  return undefined;
}

/**
 * Humanise a `code` into a fixed problem `title` for the fallback path
 * (a safe class error with no explicit table row). `AgentNotFoundError`
 * → `"Agent not found"`.
 */
function humanizeCode(code: string): string {
  const stem = code.endsWith("Error") ? code.slice(0, -5) : code;
  const spaced = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (spaced === "") return "Error";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The opaque Problem for an unrecognised / internal error — no leak. */
function opaqueProblem(status: ContentfulStatusCode): Problem {
  return toProblem({
    status,
    title: "Internal error",
    detail: "internal error",
    code: "InternalError",
  });
}

/** Outcome of {@link resolveProblem}: the wire Problem + whether it was unmapped. */
export interface ResolvedProblem {
  readonly problem: Problem;
  /** True when no table row matched — drives the "unmapped fell through" log line. */
  readonly isUnmapped: boolean;
}

/**
 * Pure projection of an error value into a {@link Problem} against a
 * domain {@link ProblemTable}. No transport, no logging — the hono-aware
 * {@link respondProblem} wraps this and writes the response.
 *
 * Resolution order:
 *   1. `ZodError` → the shared 400 `ValidationError` Problem.
 *   2. First table row whose key equals the resolved `code`
 *      (`.code` / `.type` / class `.name`) → status + title from the row,
 *      detail + extensions from its builders.
 *   3. No row + safe class error → the class `.message` as `detail`, class
 *      `.name` as `code`, humanised title, at `opts.defaultStatus ?? 400`.
 *   4. Anything else → opaque `InternalError` Problem so host paths /
 *      third-party messages never reach the wire.
 */
export function resolveProblem(
  err: unknown,
  table: ProblemTable,
  opts: RespondProblemOpts,
): ResolvedProblem {
  if (err instanceof ZodError) {
    return { problem: validationProblem(zodIssues(err)), isUnmapped: false };
  }

  const code = readErrorCode(err);
  const row = code !== undefined ? table[code] : undefined;
  if (code !== undefined && row !== undefined) {
    const detail = row.detail ? row.detail(err as never, opts) : row.title;
    const extensions = row.extension ? row.extension(err as never, opts) : undefined;
    const problem = toProblem({
      status: row.status,
      title: row.title,
      detail,
      code,
      ...(extensions !== undefined ? { extensions } : {}),
    });
    return { problem, isUnmapped: false };
  }

  const fallbackStatus = opts.defaultStatus ?? 400;
  if (err instanceof Error && SAFE_ERROR_NAMES.has(err.name)) {
    const problem = toProblem({
      status: fallbackStatus,
      title: humanizeCode(err.name),
      detail: err.message,
      code: err.name,
    });
    return { problem, isUnmapped: true };
  }
  return { problem: opaqueProblem(fallbackStatus), isUnmapped: true };
}

/**
 * Centralised catch-block responder for route handlers. Projects the
 * error into a {@link Problem} via {@link resolveProblem}, emits the
 * structured "5xx fault" or "unmapped error fell through" log line via
 * {@link logFault}, and writes the `application/problem+json` response.
 */
export function respondProblem(
  c: Context,
  err: unknown,
  table: ProblemTable,
  opts: RespondProblemOpts,
): Response {
  const { problem, isUnmapped } = resolveProblem(err, table, opts);
  const status = problem.status as ContentfulStatusCode;
  if (status >= 500) {
    logFault(c, err, `${opts.route}: 5xx fault`, opts.meta);
  } else if (isUnmapped) {
    logFault(
      c,
      err,
      `${opts.route}: unmapped error fell through to ${status}`,
      unmappedFaultMeta(err, opts.meta),
    );
  }
  return c.json(problem, status, { "content-type": PROBLEM_CONTENT_TYPE });
}

/**
 * Generic table-driven responder kept for the catalog routes, which pass
 * their domain table as `policy`. Thin adapter over {@link respondProblem}
 * that defaults unmapped errors to `500` (an unrecognised catalog error is
 * a server fault, not a bad request).
 */
export function respondError(
  c: Context,
  err: unknown,
  opts: {
    readonly route: string;
    readonly policy: ProblemTable;
    readonly meta?: Record<string, unknown>;
    readonly defaultStatus?: ContentfulStatusCode;
  },
): Response {
  return respondProblem(c, err, opts.policy, {
    route: opts.route,
    ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    defaultStatus: opts.defaultStatus ?? 500,
  });
}

/**
 * Emit a one-off {@link Problem} for a route's own inline guards (path /
 * query validation, `null`-row not-founds, precondition conflicts) that
 * don't flow from a domain `Result.Err`. Writes the same
 * `application/problem+json` envelope {@link respondProblem} produces, so
 * every error response — table-driven or inline — is byte-shape-identical
 * on the wire. `title` defaults to a humanised `code`; pass an explicit
 * `title` only when the derived one reads poorly. Extension members
 * (`transition`, `field`, …) go in `extensions`.
 */
export function problemResponse(
  c: Context,
  status: ContentfulStatusCode,
  input: {
    readonly code: string;
    readonly detail: string;
    readonly title?: string;
    readonly extensions?: Record<string, unknown>;
  },
): Response {
  const problem = toProblem({
    status,
    title: input.title ?? humanizeCode(input.code),
    detail: input.detail,
    code: input.code,
    ...(input.extensions !== undefined ? { extensions: input.extensions } : {}),
  });
  return c.json(problem, status, { "content-type": PROBLEM_CONTENT_TYPE });
}

/** Map a `ZodError`'s issues into the wire `{ path, message }[]` shape. */
function zodIssues(err: ZodError): ProblemIssue[] {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
