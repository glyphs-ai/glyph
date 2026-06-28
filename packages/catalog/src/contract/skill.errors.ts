/** Thrown when looking up a skill that doesn't exist. */
export class SkillNotFoundError extends Error {
  override readonly name = "SkillNotFoundError";

  constructor(public readonly skillName: string) {
    super(`skill not found: ${skillName}`);
  }
}

/**
 * Thrown when reinstalling an existing skill under a different origin.
 * Identity (FQN) collisions across origins are rejected — to switch
 * origins, the caller must explicitly delete then reinstall.
 */
export class SkillOriginConflictError extends Error {
  override readonly name = "SkillOriginConflictError";

  constructor(
    public readonly skillName: string,
    public readonly existingOrigin: string,
    public readonly attemptedOrigin: string,
  ) {
    super(
      `skill "${skillName}" is already installed from "${existingOrigin}"; ` +
        `refusing to overwrite with origin "${attemptedOrigin}". ` +
        "Delete and reinstall to switch origins.",
    );
  }
}

/**
 * Thrown by `install` when the resolve plan is stale — the upstream
 * anchor's `version` changed between resolve and install. Caller should
 * re-resolve before retrying. Version (not a byte hash) because glyph's
 * authoring contract requires any meaningful SKILL.md change to bump it.
 */
export class PlanStaleError extends Error {
  override readonly name = "PlanStaleError";

  constructor(
    public readonly skillName: string,
    public readonly origin: string,
    public readonly expectedVersion: string,
    public readonly actualVersion: string,
  ) {
    super(
      `plan stale for "${skillName}" @ ${origin}: ` +
        `version changed from ${expectedVersion} to ${actualVersion}. ` +
        "Re-resolve before installing.",
    );
  }
}
