/**
 * Shared constants + small helpers for the Schedules page family
 * (`pages/Schedules.tsx`, `components/schedules/*.tsx`). Lifted from
 * the Tasks `shared.ts` pattern (mission A) so each component
 * file stays narrow.
 */

import type {
  ScheduleWireTarget,
  TaskScheduleTargetWire,
  WorkflowScheduleTargetWire,
} from "@glyphs-ai/contracts";
import type { ScheduleView } from "../../api";

/** Sentinel for the "All" option in the agent filter dropdown. */
export const ALL_AGENTS = "__all__";

/** Sentinel for the "All" option in the enabled-state filter. */
export const ALL_ENABLED = "__all__";

export type EnabledFilter = "__all__" | "true" | "false";

export const ENABLED_FILTERS: { value: EnabledFilter; label: string }[] = [
  { value: ALL_ENABLED, label: "All" },
  { value: "true", label: "Enabled" },
  { value: "false", label: "Paused" },
];

/** Type guard: narrows ScheduleWireTarget to task kind. */
export function isTaskTarget(t: ScheduleWireTarget): t is TaskScheduleTargetWire {
  return t.kind === "task";
}

/** Type guard: narrows ScheduleWireTarget to workflow kind. */
export function isWorkflowTarget(t: ScheduleWireTarget): t is WorkflowScheduleTargetWire {
  return t.kind === "workflow";
}

/** Extract display agent for any schedule target. */
export function targetAgent(t: ScheduleWireTarget): string {
  if (isTaskTarget(t)) return t.agent;
  if (isWorkflowTarget(t)) return t.coordinatorAgent;
  return "";
}

/** Extract display runtime (task only, otherwise undefined). */
export function targetRuntime(t: ScheduleWireTarget): string | undefined {
  if (isTaskTarget(t)) return t.runtime;
  return undefined;
}

/**
 * Sort a list of schedules by `nextFireAt` ascending, pushing entries
 * with no `nextFireAt` (e.g. invalid expression) to the bottom. The
 * server already sorts this way; the dashboard re-applies it after
 * client-side filters so the list stays stable.
 */
export function sortByNextFire(rows: ScheduleView[]): ScheduleView[] {
  return rows.slice().sort((a, b) => {
    const at = a.nextFireAt ?? "";
    const bt = b.nextFireAt ?? "";
    if (at === "" && bt === "") return 0;
    if (at === "") return 1;
    if (bt === "") return -1;
    return at.localeCompare(bt);
  });
}
