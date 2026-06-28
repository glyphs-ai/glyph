/** Thrown when an MCP spec name violates the format rules. */
export class McpNameInvalidError extends Error {
  override readonly name = "McpNameInvalidError";

  constructor(
    public readonly mcpName: string,
    public readonly reason: string,
  ) {
    super(`invalid MCP name "${mcpName}": ${reason}`);
  }
}

/** Thrown when raw bytes can't be parsed as a valid MCP JSON file. */
export class McpInvalidJsonError extends Error {
  override readonly name = "McpInvalidJsonError";

  constructor(
    public readonly sourceLabel: string,
    public readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`invalid MCP JSON (${sourceLabel}): ${reason}`, options);
  }
}
