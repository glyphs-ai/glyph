/**
 * Shared constants + helpers for the Workflows page family
 * (`pages/Workflows.tsx`, `components/workflows/*.tsx`,
 * `pages/workflows/*.tsx`). Mirrors the layout of
 * `components/schedules/shared.ts` so each component file stays narrow.
 */

import type { AgentEntry } from "@glyphs-ai/sdk";
import type { WorkflowHeader, WorkflowNode } from "../../api";

/**
 * Hard-coded poll cadence for workflow list + detail. The server-config
 * pipeline (`config.tasks.pollIntervalMs`) doesn't carry a workflow
 * slot yet; once it does, the page can read from there instead.
 */
export const WORKFLOW_POLL_INTERVAL_MS = 2000;

/**
 * Filter an agent list to the coordinator-eligible subset — agents
 * whose server-computed `coordEligible` flag is true. The flag is
 * derived from the agent's `dependencies.agents` dispatch menu, which
 * is the workflow substrate's coordinator-capability invariant.
 * Coordinator-only surfaces (the New workflow modal and the
 * workflow-kind schedule form) share this predicate so they never
 * re-derive — and silently drift from — the substrate rule.
 */
export function coordEligibleAgents(agents: readonly AgentEntry[]): AgentEntry[] {
  return agents.filter((a) => a.coordEligible);
}

/**
 * Sort a list of workflows by `createdAt` descending so the most
 * recently dispatched run sits at the top — the same ordering the
 * Tasks page uses for its list. Stable for identical timestamps via
 * the secondary id comparator.
 */
export function sortByCreatedDesc(rows: readonly WorkflowHeader[]): WorkflowHeader[] {
  return rows.slice().sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Tone bucket for the four terminal+running workflow statuses. Used by
 * both `WorkflowStatusBadge` (label color) and `WorkflowListItem` (row
 * tint). Exhaustive switch with a `never` fall-through so any new
 * status addition becomes a compile error here instead of silently
 * rendering as the default tone.
 *
 * Mapping is locked to the Tasks page's `STATUS_TONE` (see
 * `components/tasks/shared.ts`) — same status, same colour. In
 * particular `cancelled` maps to `muted` (gray) so the workflow
 * CANCELLED badge does not visually collide with the Schedules
 * PAUSED badge (amber/warn).
 */
export type WorkflowStatusTone = "info" | "success" | "danger" | "muted";

export function workflowStatusTone(status: WorkflowHeader["status"]): WorkflowStatusTone {
  switch (status) {
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "muted";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export const WORKFLOW_STATUS_LABEL: Record<WorkflowHeader["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Per-DAG-node lifecycle status → human-readable label. Used by the
 * DAG node card's status pill (see `WorkflowDagView.tsx`) so the
 * `not_started` enum renders as `"Not started"` (which the pill's
 * `text-transform: uppercase` rule then surfaces as `"NOT STARTED"`)
 * instead of the underscored `"NOT_STARTED"` lifecycle constant
 * leaking through to the UI.
 *
 * Mirrors the {@link WORKFLOW_STATUS_LABEL} shape; the two maps are
 * intentionally separate because workflow-level statuses are a
 * proper subset (no `not_started` / `ready` — those are per-node
 * pre-dispatch states a workflow as a whole never sits in).
 */
export const WORKFLOW_NODE_STATUS_LABEL: Record<WorkflowNode["status"], string> = {
  not_started: "Not started",
  ready: "Ready",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Terminal statuses — used to gate the cancel CTA and stop polling. */
export function isTerminal(status: WorkflowHeader["status"]): boolean {
  return status !== "running";
}

/**
 * Three-bucket grouping used by `WorkflowList` to slice the list into
 * Awaiting you / Running / Completed sections. A running workflow with
 * at least one human-kind node in `running` status is placed into the
 * "awaiting" bucket so the user sees it immediately.
 */
export type StatusGroup = "awaiting" | "running" | "completed";

export function statusGroup(
  status: WorkflowHeader["status"],
  awaitingHumanCount: number,
): StatusGroup {
  if (status === "running" && awaitingHumanCount > 0) return "awaiting";
  if (status === "running") return "running";
  return "completed";
}
