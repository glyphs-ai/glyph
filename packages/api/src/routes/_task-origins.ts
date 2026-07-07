/**
 * Closed catalog of task origin kinds the wire accepts for an origin-scoped
 * task lookup (`GET /tasks?origin=&originId=`).
 *
 * `@glyphs-ai/task` keeps `TaskOrigin` an open string at the entity boundary
 * (`task-origin.ts`) and defers the closed catalog to the api tier — this is
 * that catalog. Each kind pairs with an `originId`: the schedule id for
 * `"schedule"` and the workflow-node id for `"workflow"`. `"standalone"` is a
 * direct user dispatch (its rows carry a NULL `origin_id`), so a paired lookup
 * on it is well-formed but always empty.
 *
 * A kind outside this set is a client typo (e.g. `workflowNode`, `wf`) and the
 * route rejects it with a 400 `UnknownOriginKind`.
 */

export const KNOWN_TASK_ORIGINS = ["standalone", "schedule", "workflow"] as const;

export type KnownTaskOrigin = (typeof KNOWN_TASK_ORIGINS)[number];

const KNOWN = new Set<string>(KNOWN_TASK_ORIGINS);

/** Narrow an arbitrary wire string to a known origin kind. */
export function isKnownTaskOrigin(value: string): value is KnownTaskOrigin {
  return KNOWN.has(value);
}
