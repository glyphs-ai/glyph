/**
 * Server-bootstrap preflight: asserts `@github/copilot-sdk` is
 * resolvable from this module before the server accepts traffic, so a
 * missing-dep misconfiguration surfaces at boot instead of failing
 * every `tasks.dispatch` later on.
 *
 * Called from `runServer` rather than the {@link CopilotRuntime}
 * constructor so unit-test fixtures that mock the SDK don't have to
 * satisfy a real install.
 */

import { CopilotSdkUnavailableError } from "./errors.js";

/**
 * Test seam — production callers pass no argument and get the real
 * `import.meta.resolve` (sync on Node ≥ 22).
 */
export interface CopilotPreflightDeps {
  readonly resolveSpecifier: (spec: string) => string;
}

const defaultDeps: CopilotPreflightDeps = {
  resolveSpecifier: (spec) => import.meta.resolve(spec),
};

/**
 * Returns void on success; throws {@link CopilotSdkUnavailableError}
 * (with the resolver error chained via `.cause`) on failure. The probe
 * only resolves the specifier — it never imports the SDK — so boot
 * latency stays minimal.
 */
export function assertCopilotSdkResolvable(deps: CopilotPreflightDeps = defaultDeps): void {
  try {
    deps.resolveSpecifier("@github/copilot-sdk");
  } catch (cause) {
    throw new CopilotSdkUnavailableError(cause as Error);
  }
}
