/** Thrown when looking up an agent that doesn't exist. */
export class AgentNotFoundError extends Error {
  override readonly name = "AgentNotFoundError";

  constructor(public readonly agentName: string) {
    super(`agent not found: ${agentName}`);
  }
}

/**
 * Thrown when reinstalling an existing agent under a different origin.
 * Identity (FQN) collisions across origins are rejected — to switch
 * origins, the caller must explicitly delete then reinstall.
 */
export class AgentOriginConflictError extends Error {
  override readonly name = "AgentOriginConflictError";

  constructor(
    public readonly agentName: string,
    public readonly existingOrigin: string,
    public readonly attemptedOrigin: string,
  ) {
    super(
      `agent "${agentName}" is already installed from "${existingOrigin}"; ` +
        `refusing to overwrite with origin "${attemptedOrigin}". ` +
        "Delete and reinstall to switch origins.",
    );
  }
}

/**
 * Thrown by `install` when the resolve plan is stale — the upstream
 * anchor's `version` changed between resolve and install. Caller should
 * re-resolve before retrying. Version (not a byte hash) because glyph's
 * authoring contract requires any meaningful AGENTS.md change to bump it.
 */
export class AgentPlanStaleError extends Error {
  override readonly name = "AgentPlanStaleError";

  constructor(
    public readonly agentName: string,
    public readonly origin: string,
    public readonly expectedVersion: string,
    public readonly actualVersion: string,
  ) {
    super(
      `plan stale for agent "${agentName}" @ ${origin}: ` +
        `version changed from ${expectedVersion} to ${actualVersion}. ` +
        "Re-resolve before installing.",
    );
  }
}
