/** Thrown when an agent name (FQN, scope, or short name) violates format rules. */
export class AgentNameInvalidError extends Error {
  override readonly name = "AgentNameInvalidError";

  constructor(
    public readonly agentName: string,
    public readonly reason: string,
  ) {
    super(`invalid agent name "${agentName}": ${reason}`);
  }
}

/**
 * Thrown when AGENTS.md frontmatter can't be parsed or violates the
 * schema (missing required fields, wrong types, malformed deps, ...).
 */
export class AgentFrontmatterError extends Error {
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
 * Thrown when a dep origin matches no installed entity, so the fqn<->origin
 * 1:1 invariant cannot be satisfied — either the dep was never fetched
 * upstream or the user mixed incompatible origins.
 */
export class AgentUnresolvedDepError extends Error {
  override readonly name = "AgentUnresolvedDepError";

  constructor(
    public readonly parentFqn: string,
    public readonly depKind: "skill" | "mcp" | "agent",
    public readonly depOrigin: string,
  ) {
    super(
      `unresolved ${depKind} dep on ${parentFqn}: origin "${depOrigin}" matches no installed entity ` +
        "(fqn must be bound 1:1 to origin; a sibling installed under a different origin is a different entity)",
    );
  }
}
