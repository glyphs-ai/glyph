import type { Context } from "hono";
import type { Logger } from "pino";

/**
 * Parse a JSON request body. Returns either the parsed value or an error
 * shape suitable for a 400 response. Caller validates the body further.
 */
export async function parseJsonBody<T = unknown>(
  c: Context,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const body = (await c.req.json()) as T;
    return { ok: true, body };
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function unknownBodyKey(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(body).find((key) => !allowed.has(key));
}

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
  "WorkflowWorkerSpecError",
  "WorkspaceHasLiveTasksError",
  // @glyphs-ai/catalog
  "FetchError",
  "AgentFrontmatterError",
  "SkillFrontmatterError",
  "CyclicDependencyError",
  "HasDependentsError",
  "ImmutableOriginError",
  "McpInvalidJsonError",
  "McpNameInvalidError",
  "SkillNameInvalidError",
  "AgentNameInvalidError",
  "SkillNotFoundError",
  // `AgentNotFoundError` is shared across catalog / session / schedule
  // / task — one allow-list entry covers all four. Each owning pkg
  // audits its own super(...) template for safety per the rules above.
  "AgentNotFoundError",
  "McpNotFoundError",
  "SkillOriginConflictError",
  "AgentOriginConflictError",
  "McpOriginConflictError",
  "OriginParseError",
  "PlanStaleError",
  "AgentPlanStaleError",
  "RuntimeDoesNotSupportRemoteError",
  // @glyphs-ai/session
  "InvalidSessionIdError",
  "SessionIdAllocationFailedError",
  "SessionNotFoundError",
  "SessionError",
  // @glyphs-ai/runtime
  "InvalidMcpJson",
  "RuntimeHeadlessLaunchFailed",
  "RuntimeProvisionFailed",
  "RuntimeRefreshFailed",
  "RuntimeStateDeletionFailed",
  "UnknownRuntimeError",
  "TrustRegistrationFailed",
  "RuntimeReadActivityInvalidArgs",
  // @glyphs-ai/task
  "CorruptedTaskError",
  "InvalidTaskIdError",
  "TaskNotFoundError",
  "TaskIdAllocationFailedError",
  "RuntimeDoesNotSupportTasksError",
  "EntryNotReadyError",
  "DispatchKernelEnvCollisionError",
  "TaskError",
  "InvalidTransition",
  "ManagerShuttingDownError",
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
  "InputValidationError",
  "RegistryError",
  "WorkspaceError",
  "WorkspaceIdConflictError",
  "WorkspaceIdInvalidError",
  "WorkspaceNameInvalidError",
  "WorkspaceNotRegisteredError",
  "WorkspacePathConflictError",
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
  // @glyphs-ai/catalog
  "CatalogError",
  "FetcherError",
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

/**
 * Log a server-side fault via the request-scoped logger. The line lands
 * in the rotated JSON file (`<glyphHome>/logs/server-*.log`) via pino,
 * keeping file and stderr diagnostics aligned.
 *
 * Reads `c.var.logger` (set by `requestLogger` middleware in `index.ts`)
 * and falls through silently when no logger is on the context (e.g.
 * tests that mount routes standalone). Returns void.
 *
 * `respondError` in `_respond-error.ts` calls this for both the "5xx
 * fault" and "unmapped error fell through" structured log entries.
 */
export function logFault(
  c: Context,
  err: unknown,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  // Cast widens the no-Variables `Context` type so we can probe for
  // the request-scoped logger without forcing every route factory to
  // declare a `Variables: { logger: Logger }` env up-front. The check
  // below returns silently when the logger isn't present.
  const logger = (c.get as unknown as (k: string) => unknown)("logger") as Logger | undefined;
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
  const logger = (c.get as unknown as (k: string) => unknown)("logger") as Logger | undefined;
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
 * Consumed by `respondError` in `_respond-error.ts`; routes never
 * call this directly anymore.
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
