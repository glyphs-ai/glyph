import type { ScheduleDetail } from "../../api/index.js";

/**
 * Hand-authored schedule fixtures. Stored in the DETAIL shape (i.e.
 * `Schedule & { describe }`) because the list handler can synthesise the
 * list view by stripping `describe`, whereas the reverse would need a
 * fake cronstrue call we don't want at the mock layer.
 *
 * `nextFireAt` is hand-set relative to a fixed `2026-05-28T00:00:00Z`
 * epoch so the default list sort (ascending by `nextFireAt`) is
 * stable for screenshots.
 *
 * `target.agent` FQNs (task kind) and `target.coordinatorAgent` (workflow
 * kind) must exist in `fixtureAgents` so the agent filter dropdown lists
 * them and the cross-link from the Agents page surfaces the right rows. The
 * agents used here — `official/engineer`, `official/reviewer`,
 * `official/designer` — are all present in `fixtureAgents`. The workflow-kind
 * coordinator (`official/engineer`) is `coordEligible` there so it also
 * appears in the Create modal's coordinator dropdown.
 */
const EPOCH = Date.parse("2026-05-28T00:00:00.000Z");

function isoOffsetHours(h: number): string {
  return new Date(EPOCH + h * 3_600_000).toISOString();
}

export const fixtureSchedules: ScheduleDetail[] = [
  {
    id: "sched-nightly-cleanup",
    name: "Nightly cleanup",
    trigger: { kind: "cron", expr: "0 3 * * *", tz: "Asia/Shanghai" },
    target: {
      kind: "task",
      agent: "official/engineer",
      runtime: "copilot",
      brief: "Nightly artifact + cache cleanup",
      details:
        "Sweep ephemeral artifacts, prune session caches older than 7 days, and report disk reclaim totals in the artifact JSON. Refer to docs/operations/cleanup-runbook.md for the full sweep order; keep the run idempotent so a missed night is recovered on the next fire without double-deletion.",
    },
    enabled: true,
    createdAt: "2026-05-01T08:00:00.000Z",
    updatedAt: "2026-05-20T08:00:00.000Z",
    lastFiredAt: "2026-05-27T19:00:00.000Z",
    nextFireAt: isoOffsetHours(3),
    describe: "Daily at 3:00 AM",
  },
  {
    id: "sched-hourly-report",
    name: "Hourly health report",
    trigger: { kind: "cron", expr: "0 * * * *", tz: "Asia/Shanghai" },
    target: {
      kind: "task",
      agent: "official/reviewer",
      runtime: "copilot",
      brief: "Hourly runtime-events digest to ops",
      details: "Summarise the last hour of runtime events and post the digest to ops.",
    },
    enabled: true,
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-22T09:00:00.000Z",
    lastFiredAt: "2026-05-27T23:00:00.000Z",
    nextFireAt: isoOffsetHours(1),
    describe: "Every hour on the hour",
  },
  {
    id: "sched-weekly-digest",
    name: "Weekly digest (paused)",
    trigger: { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" },
    target: {
      kind: "task",
      agent: "official/engineer",
      runtime: "claude",
      brief: "Weekly engineering digest publish",
      details: "Compose the weekly engineering digest and publish to the team feed.",
    },
    enabled: false,
    createdAt: "2026-04-15T08:00:00.000Z",
    updatedAt: "2026-05-24T08:00:00.000Z",
    nextFireAt: isoOffsetHours(33),
    describe: "Mondays at 9:00 AM",
  },
  {
    id: "sched-paused-experiment",
    name: "Paused experiment",
    trigger: { kind: "cron", expr: "*/15 * * * *", tz: "UTC" },
    target: {
      kind: "task",
      agent: "official/designer",
      brief: "Dashboard visual-diff sweep",
      details:
        "Capture before/after screenshots of the dashboard and diff them; flag visual regressions.",
    },
    enabled: false,
    createdAt: "2026-05-18T08:00:00.000Z",
    updatedAt: "2026-05-26T08:00:00.000Z",
    nextFireAt: isoOffsetHours(0.25),
    describe: "Every 15 minutes",
  },
  {
    id: "sched-release-workflow",
    name: "Nightly release workflow",
    trigger: { kind: "cron", expr: "0 2 * * *", tz: "Asia/Shanghai" },
    target: {
      kind: "workflow",
      coordinatorAgent: "official/engineer",
      brief: "Coordinate the nightly release train",
      details:
        "Fan out build → test → package across the release agents, gather the per-stage artifacts, and post a go/no-go summary to the release channel. The coordinator agent decides the worker fan-out each night based on what changed since the last green build.",
    },
    enabled: true,
    createdAt: "2026-05-12T08:00:00.000Z",
    updatedAt: "2026-05-25T08:00:00.000Z",
    lastFiredAt: "2026-05-27T18:00:00.000Z",
    nextFireAt: isoOffsetHours(2),
    describe: "Daily at 2:00 AM",
    fireStats: { awaitingCount: 0, runningCount: 1 },
  },
  {
    id: "sched-weekly-design-review",
    name: "Weekly design review",
    trigger: { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" },
    target: {
      kind: "workflow",
      coordinatorAgent: "official/coordinator",
      brief: "Kick off the Monday design review",
      details:
        "Fan out to designer + reviewer, then wait on a human approval node before publishing the summary.",
    },
    enabled: true,
    createdAt: "2026-05-04T01:00:00.000Z",
    updatedAt: "2026-05-26T01:00:00.000Z",
    lastFiredAt: "2026-05-26T01:00:00.000Z",
    nextFireAt: isoOffsetHours(48),
    describe: "Weekly on Monday at 9:00 AM",
    fireStats: { awaitingCount: 2, runningCount: 0 },
  },
  {
    id: "sched-hourly-smoke",
    name: "Hourly smoke-test workflow",
    trigger: { kind: "cron", expr: "0 * * * *", tz: "Asia/Shanghai" },
    target: {
      kind: "workflow",
      coordinatorAgent: "official/engineer",
      brief: "Hourly smoke test across the live agents",
    },
    enabled: true,
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    lastFiredAt: "2026-05-27T22:00:00.000Z",
    nextFireAt: isoOffsetHours(1),
    describe: "Every hour",
  },
];
