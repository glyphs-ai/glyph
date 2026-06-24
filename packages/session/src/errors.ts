/**
 * Errors thrown by the sessions package. All have stable `name` strings so
 * callers can branch by `e.name` without instanceof checks across realms.
 *
 * Runtime-level errors surfaced by session APIs are imported directly from
 * `@glyphs-ai/runtime` — they are not re-wrapped here so callers can distinguish
 * "runtime adapter failed" from "session-layer logic failed".
 */

export class SessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionError";
  }
}

/** A session ID supplied by a caller did not match the canonical format. */
export class InvalidSessionIdError extends SessionError {
  override readonly name = "InvalidSessionIdError";

  constructor(public readonly id: string) {
    super(`invalid session id: ${JSON.stringify(id)} (expected YYYYMMDD-xxxxxxxx)`);
  }
}

/** No session exists with the given id. */
export class SessionNotFoundError extends SessionError {
  override readonly name = "SessionNotFoundError";

  constructor(public readonly id: string) {
    super(`session not found: ${id}`);
  }
}

/** Repeated id-allocation collisions during create() (vanishingly unlikely
 * under normal use; usually indicates a stuck clock or broken RNG). */
export class SessionIdAllocationFailedError extends SessionError {
  override readonly name = "SessionIdAllocationFailedError";

  constructor(public readonly attempts: number) {
    super(
      `failed to allocate a unique session id after ${attempts} attempts ` +
        `(check the system clock and randomness source)`,
    );
  }
}

/** create() called with an agent name not present in the catalog. */
export class AgentNotFoundError extends SessionError {
  override readonly name = "AgentNotFoundError";

  constructor(
    public readonly agent: string,
    cause?: Error,
  ) {
    super(`agent not found in catalog: ${agent}${cause ? ` (${cause.message})` : ""}`, {
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

/**
 * Thrown by `SessionService.create` when the catalog raises an error
 * that is NOT "agent does not exist" — e.g. parser failure or any
 * other system-level fault while resolving the agent. Distinct from
 * {@link AgentNotFoundError}:
 *   - `AgentNotFoundError` → 400 (user passed a bad agent name)
 *   - `AgentResolutionFailedError` → 500 (catalog itself misbehaved)
 *
 * The original cause is attached as `this.cause` for the server's
 * `5xx fault` log line; the route layer collapses the body to an
 * opaque `{ error: "internal error", code: "AgentResolutionFailedError" }`
 * so internal diagnostics never reach the wire.
 */
export class AgentResolutionFailedError extends SessionError {
  override readonly name = "AgentResolutionFailedError";

  constructor(
    public readonly agent: string,
    cause?: unknown,
  ) {
    super(`agent resolution failed: ${JSON.stringify(agent)}`, {
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

/**
 * Thrown by `safeJoinUnderRoot` when a candidate path escapes or equals
 * the expected root directory. Defense-in-depth: caller has already
 * validated the session id format, so this guards against unexpected
 * path-traversal vectors (symlinks, encoding tricks, etc.).
 */
export class SessionPathEscapeError extends SessionError {
  override readonly name = "SessionPathEscapeError";

  constructor(
    public readonly candidate: string,
    public readonly root: string,
    reason: "escapes" | "equals",
  ) {
    super(
      reason === "escapes"
        ? `refused: candidate path escapes root (${candidate} not under ${root})`
        : "refused: candidate path equals root",
    );
  }
}

/**
 * Thrown by `SessionService.spawnInteractive` when no `SpawnFn` was
 * injected at compose time. Indicates a misconfiguration of the
 * composition root, not a runtime spawn failure.
 */
export class SpawnFnNotInjectedError extends SessionError {
  override readonly name = "SpawnFnNotInjectedError";

  constructor() {
    super(
      "SessionService.spawnInteractive: no spawnFn was injected at compose time " +
        "(composeSessionModule must pass `spawnFn`)",
    );
  }
}
