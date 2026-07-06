/**
 * Helpers for task use-case discriminated-union errors that pass through
 * the schedule / workflow Problem-table handling.
 */

import type { AgentNotFound, AgentResolutionFailed } from "@glyphs-ai/task";

/** Any task discriminated-union error value — every atom carries a string `type`. */
export interface TaskUnionError {
  readonly type: string;
}

export function isTaskUnionError(err: unknown): err is TaskUnionError {
  return typeof err === "object" && err !== null && "type" in err && typeof err.type === "string";
}

/**
 * The catalog `getAgent` lookup returned null while validating a schedule /
 * workflow target — the named agent does not exist. `satisfies` pins the
 * literal to task's real atom shape so a drift in the union fails here.
 */
export function taskAgentNotFound(agent: string): AgentNotFound {
  return { type: "AgentNotFound", agent } satisfies AgentNotFound;
}

/**
 * The catalog `getAgent` lookup threw (catalog unreachable / resolver crash)
 * — infrastructure, not bad caller input, so it maps to a 500 opaque body.
 */
export function taskAgentResolutionFailed(agent: string, cause: unknown): AgentResolutionFailed {
  return { type: "AgentResolutionFailed", agent, cause } satisfies AgentResolutionFailed;
}
