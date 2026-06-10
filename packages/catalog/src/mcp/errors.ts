import { CatalogError } from "../errors.js";

/** Thrown when an MCP spec name violates the format rules. */
export class McpNameInvalidError extends CatalogError {
  override readonly name = "McpNameInvalidError";

  constructor(
    public readonly mcpName: string,
    public readonly reason: string,
  ) {
    super(`invalid MCP name "${mcpName}": ${reason}`);
  }
}

/** Thrown when looking up an MCP that doesn't exist. */
export class McpNotFoundError extends CatalogError {
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
export class McpOriginConflictError extends CatalogError {
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

/** Thrown when raw bytes can't be parsed as a valid MCP JSON file. */
export class McpInvalidJsonError extends CatalogError {
  override readonly name = "McpInvalidJsonError";

  constructor(
    public readonly sourceLabel: string,
    public readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`invalid MCP JSON (${sourceLabel}): ${reason}`, options);
  }
}
