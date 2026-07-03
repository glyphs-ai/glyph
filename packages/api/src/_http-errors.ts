import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "pino";
import { ZodError } from "zod";

/**
 * Allow-list of error class `name`s whose `.message` is safe to surface in
 * an HTTP response body. Each entry is a typed error from a glyph
 * package whose message is intentionally user-facing (no host paths, no
 * caller-controlled echoes, no Node `fs` error strings — kind / identifier
 * only).
 *
 * Anything outside this list — generic `Error`, `EACCES`/`ENOENT` from
 * the filesystem, syntax errors, third-party errors — collapses to a
 * generic "internal error" to avoid leaking host paths or implementation
 * details (e.g. `EACCES: permission denied, open '/etc/shadow'`).
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
  "TaskScheduleTargetError",
  "WorkflowCoordAgentNotCapableError",
  "WorkflowCoordSpecError",
  "WorkflowHumanSpecError",
  "WorkflowWorkerSpecError",
  "WorkspaceHasLiveTasksError",
  "WorkspaceLoadError",
  // @glyphs-ai/catalog exposes DU errors; catalog route responses are
  // projected directly from policy code matches rather than class names.
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
  // schedule's own `AgentNotFoundError` shares the name string with
  // the catalog + session variants already on this list — one allow-list
  // entry covers all three callers. The schedule class's super(...)
  // template (`Agent "${agent}" not found`, see
  // `packages/schedule/src/errors.ts`) is audited safe: no host paths,
  // no caller-controlled echoes beyond the agent FQN the caller
  // themselves provided.
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
  //   DU-based: `WorkspaceIdConflict` / `WorkspaceNotFound` /
  //   `WorkspacePathConflict` / `DatabaseUnavailable` /
  //   `ProvisioningFailed` flow through `respondWorkspaceError`,
  //   which builds the wire body directly from the DU `type` and
  //   bypasses this allow-list entirely.
  // @glyphs-ai/workflow
  "WorkflowError",
  "WorkflowNotFoundError",
  "WorkflowNodeNotFoundError",
  "InvalidWorkflowIdError",
  "InvalidWorkflowNodeIdError",
  "WorkflowAlreadyTerminalError",
  "WorkflowNodeNotMutableError",
  "WorkflowEdgeCycleError",
  "WorkflowEdgeNotFoundError",
  "WorkflowNodeSpecError",
  "MultipleSuccessorCoordsError",
  "OrphanCoordInsertError",
  "ParentStateError",
  "EmptyParentsError",
  "WorkflowRemoveNodeOrphansChildError",
  "WorkflowRemoveEdgeOrphansChildError",
  "WorkflowDagInvariantError",
  "WorkflowSubgraphEmptyError",
  "WorkflowSubgraphTempIdInvalidError",
  "WorkflowSubgraphTempParentlessError",
  "WorkflowSubgraphNodeRefUnresolvedError",
  "WorkflowSubgraphCyclicError",
  "WorkflowSubgraphMultipleCoordTempsError",
  // Caller-facing kind shape guard. Reachable from
  // `POST .../nodes` / `POST .../subgraph` when the caller supplies a
  // body with a non-string or empty `kind`; the substrate's defensive
  // throw surfaces the value the caller sent.
  // Messages echo only caller-supplied values — no host paths, no
  // third-party stack lines.
  "WorkflowNodeKindShapeError",
]);

/**
 * Error classes exported by (or reachable from) glyph packages whose
 * messages intentionally stay off the HTTP wire. They either carry
 * host paths / underlying causes, represent boot-time or
 * operator-configuration faults, or are projected to a route-specific
 * envelope before they reach `errorBody`.
 *
 * Keep this list in sync with public error exports from `@glyphs-ai/*`:
 * every exported error class should be present here, in
 * `SAFE_ERROR_NAMES`, or in a route policy with a custom opaque body.
 */
export const INTERNAL_ERROR_NAMES = new Set<string>([
  // @glyphs-ai/cli / @glyphs-ai/dashboard
  "ApiError",
  // @glyphs-ai/api
  "WorkflowWorkerNotInCoordMenuError",
  // @glyphs-ai/catalog uses DU errors and has no exported error classes.
  // @glyphs-ai/runtime
  "CopilotSdkUnavailableError",
  "UnknownPlaceholderError",
  // @glyphs-ai/session / @glyphs-ai/task
  "AgentResolutionFailedError",
  // @glyphs-ai/schedule
  "ScheduleKindMismatchError",
  "ScheduleKindAlreadyRegisteredError",
  "ScheduleKindNotRegisteredError",
  "ScheduleKindRegistryFrozenError",
  // @glyphs-ai/workflow
  "WorkflowNodeKindCorruptionError",
  "WorkflowEnumValueCorruptionError",
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
 * `respondError` calls this for both the "5xx fault" and "unmapped error
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
 * Standard error response shape: `{ error, code? }`. The `code` field
 * carries the error class name so the dashboard can render typed UI without
 * string-matching the message.
 *
 * Errors NOT in `SAFE_ERROR_NAMES` are flattened to `"internal error"` so
 * that filesystem error messages, third-party stack traces, and
 * caller-controlled echoes never reach the client. Routes that map a
 * specific typed error to a specific HTTP status before calling this
 * helper still get the original message + code.
 */
export function errorBody(err: unknown): { error: string; code?: string } {
  if (err instanceof Error) {
    if (SAFE_ERROR_NAMES.has(err.name)) {
      return { error: err.message, code: err.name };
    }
    if (INTERNAL_ERROR_NAMES.has(err.name)) {
      return { error: "internal error" };
    }
  }
  return { error: "internal error" };
}

/**
 * Shared meta builder for the "unmapped fell through to 400" log
 * entry. Pulls the unknown error's `name` and `message` onto the
 * structured log line (in addition to the full `err` serialiser pino
 * already attaches via `logFault`) so the operator can `jq` for
 * unmapped error classes without parsing every nested `err.type`.
 *
 * Consumed by `respondError`; routes never call this directly.
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
 * One entry on an {@link ErrorPolicy}: an error class, the HTTP status
 * it maps to, and an optional class-stable body builder.
 *
 * Use the third slot ONLY for envelopes whose shape depends on the
 * error value alone — not on the route. Example: `EntryNotReady`
 * always returns `{ error, code, agent, reason }` regardless of which
 * route caught it, so its body builder lives on the policy entry.
 *
 * Counter-example: `InvalidTransition` returns
 * `{ error, code, status, transition }` where `transition` is `"cancel"`
 * on `tasks.cancel` and `"delete"` on `tasks.delete`. That body is
 * route-dependent — pass it via `RespondErrorOpts.customBody`, not here.
 */
type StatusEntry = readonly [
  klass: new (...args: never[]) => Error,
  status: ContentfulStatusCode,
  classStableBody?: (err: Error) => Record<string, unknown>,
];

export type CodeStatusEntry = readonly [
  code: string,
  status: ContentfulStatusCode,
  codeStableBody?: (err: unknown) => Record<string, unknown>,
];

/**
 * A per-domain error policy — ordered lists of `(class, status, body?)`
 * and `(code, status, body?)` triples plus an optional default status.
 * Each domain (tasks / schedules / sessions / workspaces / catalog)
 * maintains its own policy so name-equal classes or code-equal tagged
 * errors from different domains map independently.
 */
export interface ErrorPolicy {
  readonly name: string;
  readonly statuses: ReadonlyArray<StatusEntry>;
  readonly codeStatuses?: ReadonlyArray<CodeStatusEntry>;
  /**
   * Status used when no `statuses` entry matches the thrown error.
   * Defaults to 400. Some routes (read-only / server-failure paths)
   * override per-call via `RespondErrorOpts.defaultStatus`.
   */
  readonly defaultStatus?: ContentfulStatusCode;
}

export interface RespondErrorOpts {
  /**
   * Route label that lands on the structured log line, e.g.
   * `"tasks.cancel"` / `"sessions.create"`. Used as the message prefix
   * for both the "5xx fault" and "unmapped error fell through" log
   * entries so operators can grep by route.
   */
  readonly route: string;
  readonly policy: ErrorPolicy;
  /**
   * Extra meta fields to attach to the structured log line
   * (`taskId`, `sessionId`, etc.). Forwarded verbatim to
   * {@link logFault}; included in `unmappedFaultMeta` when the error
   * class is unmapped.
   */
  readonly meta?: Record<string, unknown>;
  /**
   * Per-call body builder that takes precedence over both the matched
   * entry's class-stable body and the default `errorBody`. Used for
   * route-dependent envelopes (e.g. `InvalidTransition` with verb).
   * Return `null` to fall back to the class-stable / default body.
   */
  readonly customBody?: (
    err: unknown,
    status: ContentfulStatusCode,
  ) => Record<string, unknown> | null;
  /**
   * Per-call override of `policy.defaultStatus`. Mapped-class status
   * (from `policy.statuses`) always wins; this only changes the
   * fallthrough for unmapped errors.
   */
  readonly defaultStatus?: ContentfulStatusCode;
}

/**
 * Centralised catch-block body for route handlers. Resolves status via
 * the per-domain `ErrorPolicy`, emits the structured "5xx fault" or
 * "unmapped error fell through" log line via {@link logFault}, and
 * returns the JSON response.
 *
 * Status resolution:
 *   - First `instanceof` match in `policy.statuses` wins (order is
 *     significant — list subclasses before their bases).
 *   - If no class matches, first `.code` match in `policy.codeStatuses`
 *     wins.
 *   - On no match: status falls back to
 *     `opts.defaultStatus ?? policy.defaultStatus ?? 400`, and the
 *     entry is flagged `isUnmapped` so the log path fires.
 *
 * Body precedence:
 *   1. `opts.customBody(err, status)` when defined AND returns non-null
 *   2. The matched entry's `classStableBody(err)` if present
 *   3. The matched entry's `codeStableBody(err)` if present
 *   4. {@link errorBody} fallback (collapses unrecognised classes to
 *      `{ error: "internal error" }` per `SAFE_ERROR_NAMES`)
 */
export function respondError(c: Context, err: unknown, opts: RespondErrorOpts): Response {
  // Input-schema parse failures (service-layer `Schema.parse(...)`)
  // surface as ZodError. Map them to the same 400 `ValidationError`
  // envelope that `createApiApp`'s request `defaultHook` produces, so a
  // failed request-body/param validation and a failed service-input
  // validation look identical on the wire.
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "request validation failed",
        code: "ValidationError",
        issues: err.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }

  let status: ContentfulStatusCode | undefined;
  let classStableBody: ((err: Error) => Record<string, unknown>) | undefined;
  let codeStableBody: ((err: unknown) => Record<string, unknown>) | undefined;

  if (err instanceof Error) {
    for (const entry of opts.policy.statuses) {
      const [klass, entryStatus, bodyBuilder] = entry;
      if (err instanceof klass) {
        status = entryStatus;
        classStableBody = bodyBuilder;
        break;
      }
    }
  }

  const errorCode = readErrorCode(err);
  if (status === undefined && errorCode !== undefined) {
    for (const entry of opts.policy.codeStatuses ?? []) {
      const [code, entryStatus, bodyBuilder] = entry;
      if (errorCode === code) {
        status = entryStatus;
        codeStableBody = bodyBuilder;
        break;
      }
    }
  }

  const isUnmapped = status === undefined;
  const finalStatus: ContentfulStatusCode =
    status ?? opts.defaultStatus ?? opts.policy.defaultStatus ?? 400;

  if (finalStatus >= 500) {
    logFault(c, err, `${opts.route}: 5xx fault`, opts.meta);
  } else if (isUnmapped) {
    logFault(
      c,
      err,
      `${opts.route}: unmapped error fell through to ${finalStatus}`,
      unmappedFaultMeta(err, opts.meta),
    );
  }

  let body: Record<string, unknown>;
  const fromCustom = opts.customBody?.(err, finalStatus);
  if (fromCustom !== undefined && fromCustom !== null) {
    body = fromCustom;
  } else if (classStableBody !== undefined && err instanceof Error) {
    body = classStableBody(err);
  } else if (codeStableBody !== undefined) {
    body = codeStableBody(err);
  } else {
    body = errorBody(err);
  }

  return c.json(body, finalStatus);
}

function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = err.code;
  return typeof code === "string" ? code : undefined;
}
