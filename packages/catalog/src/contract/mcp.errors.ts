/** Thrown when looking up an MCP that doesn't exist. */
export class McpNotFoundError extends Error {
  override readonly name = "McpNotFoundError";

  constructor(public readonly mcpName: string) {
    super(`MCP not found: ${mcpName}`);
  }
}

/**
 * Thrown when reinstalling an existing MCP under a different origin.
 * Identity (name) collisions across origins are rejected — to switch
 * origins, the caller must explicitly delete then reinstall.
 */
export class McpOriginConflictError extends Error {
  override readonly name = "McpOriginConflictError";

  constructor(
    public readonly mcpName: string,
    public readonly existingOrigin: string,
    public readonly attemptedOrigin: string,
  ) {
    super(
      `MCP "${mcpName}" is already installed from "${existingOrigin}"; ` +
        `refusing to overwrite with origin "${attemptedOrigin}". ` +
        "Delete and reinstall to switch origins.",
    );
  }
}
