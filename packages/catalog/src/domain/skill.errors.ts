/** Thrown when a skill name (FQN, scope, or short name) violates format rules. */
export class SkillNameInvalidError extends Error {
  override readonly name = "SkillNameInvalidError";

  constructor(
    public readonly skillName: string,
    public readonly reason: string,
  ) {
    super(`invalid skill name "${skillName}": ${reason}`);
  }
}

/**
 * Thrown when SKILL.md frontmatter can't be parsed or violates the
 * schema (missing required fields, wrong types, malformed deps, ...).
 */
export class SkillFrontmatterError extends Error {
  override readonly name = "SkillFrontmatterError";

  constructor(
    public readonly sourceLabel: string,
    public readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`invalid SKILL.md frontmatter (${sourceLabel}): ${reason}`, options);
  }
}

/**
 * Thrown by the resolve walker when the dependency graph contains a
 * back-edge (some entry transitively depends on itself). Glyph rejects
 * cyclic catalog deps at install/sync time; the user must break the cycle
 * in the upstream frontmatter. `cycle` is the back-edge origin path, e.g.
 * `[a, b, a]` means a depends on b which depends on a. Origins (not fqns)
 * are used because the repeat anchor may be unparsed at throw time.
 */
export class CyclicDependencyError extends Error {
  override readonly name = "CyclicDependencyError";

  constructor(public readonly cycle: readonly string[]) {
    super(
      `circular skill dependency detected: ${cycle.join(" \u2192 ")}. ` +
        "Glyph does not support cyclic catalog deps; break the cycle by " +
        "removing one of the dep refs in the upstream frontmatter and re-installing.",
    );
  }
}

/**
 * Thrown when a dep origin matches no installed entity, so the fqn<->origin
 * 1:1 invariant cannot be satisfied — either the dep was never fetched
 * upstream or the user mixed incompatible origins.
 */
export class SkillUnresolvedDepError extends Error {
  override readonly name = "SkillUnresolvedDepError";

  constructor(
    public readonly parentFqn: string,
    public readonly depKind: "skill" | "mcp",
    public readonly depOrigin: string,
  ) {
    super(
      `unresolved ${depKind} dep on ${parentFqn}: origin "${depOrigin}" matches no installed entity ` +
        "(fqn must be bound 1:1 to origin; a sibling installed under a different origin is a different entity)",
    );
  }
}
