import { CatalogError } from "../errors.js";

/** Thrown when an agent name (FQN, scope, or short name) violates format rules. */
export class AgentNameInvalidError extends CatalogError {
  override readonly name = "AgentNameInvalidError";

  constructor(
    public readonly agentName: string,
    public readonly reason: string,
  ) {
    super(`invalid agent name "${agentName}": ${reason}`);
  }
}

/** Thrown when looking up an agent that doesn't exist. */
export class AgentNotFoundError extends CatalogError {
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
export class AgentOriginConflictError extends CatalogError {
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
 * Thrown when AGENTS.md frontmatter can't be parsed or violates the
 * schema (missing required fields, wrong types, malformed deps, ...).
 */
export class AgentFrontmatterError extends CatalogError {
  override readonly name = "AgentFrontmatterError";

  constructor(
    public readonly sourceLabel: string,
    public readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`invalid AGENTS.md frontmatter (${sourceLabel}): ${reason}`, options);
  }
}

/**
 * Thrown by `install` when the resolve plan is stale — i.e. the
 * upstream anchor's `version` changed between resolve and install.
 * Caller should re-resolve before retrying.
 *
 * Why `version` (not a byte hash)? Glyph's authoring contract
 * requires any meaningful change to AGENTS.md to bump `version`; an
 * unbumped edit is, by contract, not a change glyph needs to react
 * to.
 */
export class AgentPlanStaleError extends CatalogError {
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
