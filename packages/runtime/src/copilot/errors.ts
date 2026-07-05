/**
 * Errors specific to the Copilot runtime. Generic runtime errors live in
 * `../errors.ts`.
 */

/**
 * Thrown by {@link assertCopilotSdkResolvable} (the server-bootstrap
 * preflight) when `@github/copilot-sdk` or its transitive
 * `@github/copilot` CLI dep cannot be resolved from the running
 * process's module graph.
 *
 * The message intentionally carries the install hint and the underlying
 * Node `ERR_MODULE_NOT_FOUND` chain so operators see exactly what's
 * missing without having to grep server logs.
 *
 * This is a boot-time configuration error: the publishing pipeline
 * shipped a bundle whose runtime dep wasn't declared in the published
 * `package.json`, or the operator manually deleted the SDK from
 * `node_modules` after install. Either way, every `tasks.dispatch`
 * against the copilot runtime would otherwise fail silently with
 * `HTTP 400 internal error` and no server log entry — surface it
 * loudly at startup instead.
 */
export class CopilotSdkUnavailableError extends Error {
  constructor(cause: Error) {
    super(
      [
        "copilot runtime requires @github/copilot-sdk (and its @github/copilot CLI dep).",
        "Install via: npm install -g @github/copilot-sdk",
        `Detail: ${cause.message}`,
      ].join("\n"),
    );
    this.name = "CopilotSdkUnavailableError";
    this.cause = cause;
  }
}
