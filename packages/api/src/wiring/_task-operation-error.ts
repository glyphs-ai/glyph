/**
 * Carrier for task use-case union errors that need to pass through the
 * schedule / workflow `ErrorPolicy` handling.
 *
 * Exposes the union discriminator as `.code` for `codeStatuses` matching and
 * the full union value as `.detail` for status-specific wire-body builders.
 */

import type { AgentNotFound, AgentResolutionFailed } from "@glyphs-ai/task";

/** Any task discriminated-union error value — every atom carries a string `type`. */
export interface TaskUnionError {
  readonly type: string;
}

export class TaskOperationError extends Error {
  override readonly name = "TaskOperationError";
  /** The union discriminator, surfaced to `ErrorPolicy.codeStatuses`. */
  readonly code: string;
  /** The full union value, read by the code-stable wire-body builder. */
  readonly detail: TaskUnionError;
  constructor(detail: TaskUnionError) {
    super(detail.type);
    this.code = detail.type;
    this.detail = detail;
  }
}

/**
 * The catalog `getAgent` lookup returned null while validating a schedule /
 * workflow target — the named agent does not exist. `satisfies` pins the
 * literal to task's real atom shape so a drift in the union fails here.
 */
export function taskAgentNotFound(agent: string): TaskOperationError {
  const detail: AgentNotFound = { type: "AgentNotFound", agent };
  return new TaskOperationError(detail);
}

/**
 * The catalog `getAgent` lookup threw (catalog unreachable / resolver crash)
 * — infrastructure, not bad caller input, so it maps to a 500 opaque body.
 */
export function taskAgentResolutionFailed(agent: string, cause: unknown): TaskOperationError {
  const detail: AgentResolutionFailed = { type: "AgentResolutionFailed", agent, cause };
  return new TaskOperationError(detail);
}
