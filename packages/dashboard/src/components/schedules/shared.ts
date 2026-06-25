/**
 * Shared constants + small helpers for the Schedules page family
 * (`pages/Schedules.tsx`, `components/schedules/*.tsx`).
 */

import type {
  ScheduleTarget,
  TaskScheduleTarget,
  WorkflowScheduleTarget,
} from "@glyphs-ai/contracts";
import type { ScheduleView } from "../../api";

export const DEFAULT_SCHEDULE_KIND = "task";
export type ScheduleKindFilter = "task" | "workflow";
export const SCHEDULE_KIND_FILTERS: readonly { value: ScheduleKindFilter; label: string }[] = [
  { value: "task", label: "Tasks" },
  { value: "workflow", label: "Workflows" },
];

export const DEFAULT_SCHEDULE_STATE_FILTER = "all";
export type ScheduleStateFilter = "all" | "enabled" | "paused";
export const SCHEDULE_STATE_FILTERS: readonly { value: ScheduleStateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "paused", label: "Paused" },
];

export const DEFAULT_WORKFLOW_ACTIVITY_FILTER = "all";
export type WorkflowActivityFilter = "all" | "awaiting" | "running" | "idle";
export const WORKFLOW_ACTIVITY_FILTERS: readonly {
  value: WorkflowActivityFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Awaiting" },
  { value: "running", label: "Running" },
  { value: "idle", label: "Idle" },
];

/** Type guard: narrows ScheduleTarget to task kind. */
export function isTaskTarget(t: ScheduleTarget): t is TaskScheduleTarget {
  return t.kind === "task";
}

/** Type guard: narrows ScheduleTarget to workflow kind. */
export function isWorkflowTarget(t: ScheduleTarget): t is WorkflowScheduleTarget {
  return t.kind === "workflow";
}

/** Extract display agent for any schedule target. */
export function targetAgent(t: ScheduleTarget): string {
  if (isTaskTarget(t)) return t.agent;
  if (isWorkflowTarget(t)) return t.coordinatorAgent;
  return "";
}

/** Extract display runtime (task only, otherwise undefined). */
export function targetRuntime(t: ScheduleTarget): string | undefined {
  if (isTaskTarget(t)) return t.runtime;
  return undefined;
}

/** Extract the one-line brief shared by the task and workflow kinds. */
export function targetBrief(t: ScheduleTarget): string {
  if (isTaskTarget(t) || isWorkflowTarget(t)) return t.brief;
  return "";
}

/** Extract the optional multi-line details shared by the task and workflow kinds. */
export function targetDetails(t: ScheduleTarget): string | undefined {
  if (isTaskTarget(t) || isWorkflowTarget(t)) return t.details;
  return undefined;
}

export function matchesStateFilter(
  schedule: ScheduleView,
  stateFilter: ScheduleStateFilter,
): boolean {
  if (stateFilter === "enabled") return schedule.enabled;
  if (stateFilter === "paused") return !schedule.enabled;
  return true;
}

export function matchesWorkflowActivityFilter(
  schedule: ScheduleView,
  activityFilter: WorkflowActivityFilter,
): boolean {
  if (schedule.target.kind !== "workflow" || activityFilter === "all") return true;
  const awaitingCount = schedule.fireStats?.awaitingCount ?? 0;
  const runningCount = schedule.fireStats?.runningCount ?? 0;
  if (activityFilter === "awaiting") return awaitingCount > 0;
  if (activityFilter === "running") return runningCount > 0;
  return schedule.enabled && awaitingCount === 0 && runningCount === 0;
}

/**
 * Sort a list of schedules by `nextFireAt` ascending, pushing entries
 * with no `nextFireAt` to the bottom.
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
