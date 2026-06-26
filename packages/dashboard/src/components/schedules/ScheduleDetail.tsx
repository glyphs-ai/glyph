import type { ScheduleTarget } from "@glyphs-ai/contracts";
import { type ReactNode, useEffect, useState } from "react";
import {
  getSchedule,
  previewSchedule,
  type ScheduleDetail as ScheduleDetailType,
  type SchedulePreview,
  type WorkflowHeader,
} from "../../api";
import { formatAbsolute, formatRelative } from "../../utils/time";
import { ScheduleRecentFires } from "./ScheduleRecentFires";
import { targetAgent, targetBrief, targetDetails, targetRuntime } from "./shared";

/** Which body tab the schedule detail pane is showing. */
export type ScheduleDetailTab = "fires" | "spec";

export interface ScheduleDetailProps {
  scheduleId: string;
  currentWorkspaceId: string;
  /** Bumped by the parent after a successful list mutation (e.g. delete or row Pause/Resume) so we re-fetch the canonical detail + preview. */
  refreshToken: number;
  /** Bumped by the parent's row-level Run now success (only when the run targeted the currently-selected schedule) so the recent-fires panel re-fetches. */
  recentFiresToken: number;
  /**
   * Optimistic-enabled override sourced from the parent's list state.
   * Patches the one flag the parent can be authoritative about during
   * optimistic flips: when a row's Pause/Resume click flips the list
   * row's badge immediately, the detail pane's badge MUST flip in the
   * same frame — otherwise the same screen shows two contradictory
   * states for ~one network roundtrip (the detail pane's internal
   * `getSchedule(scheduleId)` re-fetch only runs after `refreshToken`
   * bumps, which the parent only bumps on patch success). The override
   * naturally rolls back when the parent rolls its list-state flip
   * back on patch failure. `undefined` means the parent has no
   * authoritative value yet (initial load); fall back to the
   * server-fetched `detail.enabled` in that case.
   */
  enabledOverride?: boolean;
  /** Swaps the right pane into Mode B (fire's task detail) via the parent's atomic URL writer. */
  onSelectFire: (taskId: string) => void;
  onCancelTaskFire: (taskId: string) => Promise<void> | void;
  onCancelWorkflowFire: (workflow: WorkflowHeader) => Promise<void> | void;
  /**
   * Active body tab. URL-driven at the page level (`?tab=fires|spec`)
   * so it survives reload and is shareable; `fires` is the default.
   */
  tab: ScheduleDetailTab;
  /** Switch the active body tab — writes `?tab=` via the page's atomic URL writer. */
  onTabChange: (tab: ScheduleDetailTab) => void;
}

const PREVIEW_COUNT = 1;

/**
 * Right-pane detail view for a single schedule.
 *
 * Header: two-column row — left side carries the schedule's identity
 * (name + enabled badge, cron expr + tz + describe, agent + runtime),
 * right side carries the temporal facts (next fire, last fired).
 *
 * Body: a task-style `header + tabs + body` shell. Two tabs —
 * `Recent fires (N)` (default) shows the fire history full-width;
 * `Spec` stacks the Brief and (optional) Details cards. The active
 * tab is URL-driven via `?tab=fires|spec` so it survives reload. We
 * do NOT render a "Next N fires" list — the single next-fire fact
 * lives in the header where users actually look for it.
 *
 * Row-level actions (Edit / Pause-Resume / Run-now / Delete) now live
 * exclusively in the list's per-row `⋯` menu (see `ScheduleListItem`).
 * The detail pane is the canonical *information* surface; the list is
 * the canonical *action* surface. The page-level
 * `refreshToken` / `recentFiresToken` props are the seams that keep
 * the detail in sync after a row mutation.
 *
 * The next-fire preview is fetched on schedule change and on each
 * page-driven `refreshToken` bump. We still ask the server for `n=1`
 * rather than computing locally because cron parsing + tz handling is
 * the server's job; the dashboard just renders.
 */
export function ScheduleDetail({
  scheduleId,
  currentWorkspaceId,
  refreshToken,
  recentFiresToken,
  enabledOverride,
  onSelectFire,
  onCancelTaskFire,
  onCancelWorkflowFire,
  tab,
  onTabChange,
}: ScheduleDetailProps) {
  const [detail, setDetail] = useState<ScheduleDetailType | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Resolved recent-fires count, surfaced by `<ScheduleRecentFires>` via
  // `onCountChange`. `null` until the first fetch resolves so the tab
  // badge can read "Recent fires" rather than a misleading "(0)".
  const [firesCount, setFiresCount] = useState<number | null>(null);

  // Fetch detail + preview together so the header always renders with
  // a consistent describe / next-fire pair.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is intentionally part of the re-fetch trigger set; parent bumps it after delete to reseed the surface
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetail(null);
    setPreview(null);
    void Promise.all([
      getSchedule(scheduleId),
      previewSchedule(scheduleId, { n: PREVIEW_COUNT }).catch((e: unknown) => e),
    ]).then(
      ([d, p]) => {
        if (cancelled) return;
        setDetail(d);
        if (p instanceof Error) {
          // Preview failure is non-fatal — the detail header still renders;
          // we just hide the next-fire list and surface a small note.
          setPreview({ describe: d.describe, nextRuns: [] });
        } else {
          setPreview(p as SchedulePreview);
        }
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scheduleId, refreshToken]);

  if (error && detail === null) {
    return (
      <aside className="tasks-pane__detail">
        <div className="alert alert--error">⚠️ {error}</div>
      </aside>
    );
  }
  if (detail === null) {
    return (
      <aside className="tasks-pane__detail">
        <p className="muted" style={{ padding: 16 }}>
          Loading…
        </p>
      </aside>
    );
  }

  return (
    <aside className="tasks-pane__detail schedule-detail">
      {error && (
        <div className="alert alert--error" style={{ margin: "0 0 12px 0" }}>
          ⚠️ {error}
        </div>
      )}
      <header className="task-detail__head schedule-detail__head">
        <div className="schedule-detail__head-row">
          <div className="schedule-detail__head-left">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{detail.name}</h2>
              {(() => {
                const displayEnabled = enabledOverride ?? detail.enabled;
                return (
                  <span
                    className={`badge ${
                      displayEnabled ? "badge--success" : "badge--warn"
                    } badge--with-dot`}
                  >
                    <span className="badge__dot" aria-hidden="true" />
                    {displayEnabled ? "Enabled" : "Paused"}
                  </span>
                );
              })()}
            </div>
            <div className="task-list__item-meta muted">
              <code className="schedule-cron" title={`Cron expression in ${detail.trigger.tz}`}>
                {detail.trigger.expr}
              </code>
              <span className="task-list__sep">·</span>
              <span>{detail.trigger.tz}</span>
              <span className="task-list__sep">·</span>
              <span title="cronstrue (server-rendered)">{detail.describe}</span>
            </div>
            <div className="task-list__item-meta muted">
              <span>
                {detail.target.kind === "workflow" ? "Coordinator: " : "Agent: "}
                <strong style={{ fontWeight: 600 }}>{targetAgent(detail.target)}</strong>
              </span>
              {targetRuntime(detail.target) ? (
                <>
                  <span className="task-list__sep">·</span>
                  <span>Runtime: {targetRuntime(detail.target)}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="schedule-detail__head-right" data-testid="schedule-detail-temporal">
            <ScheduleNextFire preview={preview} enabled={enabledOverride ?? detail.enabled} />
            <ScheduleLastFired lastFiredAt={detail.lastFiredAt} />
          </div>
        </div>
      </header>

      <nav
        className="task-tabs"
        aria-label="Schedule detail sections"
        data-testid="schedule-detail-tabs"
      >
        <button
          type="button"
          className={`task-tabs__btn${tab === "fires" ? " task-tabs__btn--active" : ""}`}
          aria-pressed={tab === "fires"}
          data-testid="schedule-detail-tab-fires"
          onClick={() => onTabChange("fires")}
        >
          {firesCount === null ? "Recent fires" : `Recent fires (${firesCount})`}
        </button>
        <button
          type="button"
          className={`task-tabs__btn${tab === "spec" ? " task-tabs__btn--active" : ""}`}
          aria-pressed={tab === "spec"}
          data-testid="schedule-detail-tab-spec"
          onClick={() => onTabChange("spec")}
        >
          Spec
        </button>
      </nav>

      {tab === "fires" ? (
        <div className="task-detail__body" data-testid="schedule-detail-panel-fires">
          <ScheduleRecentFires
            scheduleId={scheduleId}
            kind={detail.target.kind}
            currentWorkspaceId={currentWorkspaceId}
            refreshToken={recentFiresToken}
            onSelectFire={onSelectFire}
            onCancelTaskFire={onCancelTaskFire}
            onCancelWorkflowFire={onCancelWorkflowFire}
            onCountChange={setFiresCount}
          />
        </div>
      ) : (
        <SpecPanel target={detail.target} />
      )}
    </aside>
  );
}

/**
 * `Spec` tab body — Brief on top, optional Details below, reusing the
 * `TaskDetail/OverviewTab` card primitives (`.overview-tab` +
 * `.overview-card*`). Each card is `flex: 1` with an internally
 * scrolling body, so a long Details prompt scrolls inside its card
 * instead of pushing the layout. When Details is empty the Brief card
 * fills the whole body height (matches Overview's "Details only"
 * branch).
 */
function SpecPanel({ target }: { target: ScheduleTarget }) {
  const details = targetDetails(target)?.trim() ?? "";
  const hasDetails = details.length > 0;
  return (
    <div className="overview-tab" data-testid="schedule-detail-panel-spec">
      <SpecCard title="Brief" className="overview-card--brief" testId="schedule-detail-brief-card">
        <p
          className="muted"
          style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.45, margin: 0 }}
        >
          {targetBrief(target)}
        </p>
      </SpecCard>
      {hasDetails && (
        <SpecCard
          title="Details"
          className="overview-card--details"
          testId="schedule-detail-details-card"
        >
          <pre className="overview-card__pre">{details}</pre>
        </SpecCard>
      )}
    </div>
  );
}

/**
 * Pinned-title card with an internally-scrolling body — the same chrome
 * `OverviewTab` uses for its Summary / Details cards so the two surfaces
 * read as equals.
 */
function SpecCard({
  title,
  className,
  testId,
  children,
}: {
  title: string;
  className: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className={`overview-card ${className}`} data-testid={testId}>
      <header className="overview-card__head">
        <h3 className="overview-card__title">{title}</h3>
      </header>
      <div className="overview-card__body">{children}</div>
    </section>
  );
}

/**
 * Header right-column primitive — the single next-fire fact. Renders
 * a relative time ("in 5m") as primary with the absolute time as the
 * tooltip, mirroring the dashboard's "relative is the headline,
 * absolute is the proof" convention. When the schedule is paused or
 * the preview hasn't loaded yet, surfaces a one-line placeholder so
 * the right column never collapses to nothing (which would re-create
 * the empty-right-side imbalance the two-column header was added to
 * fix).
 */
function ScheduleNextFire({
  preview,
  enabled,
}: {
  preview: SchedulePreview | null;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <div className="schedule-detail__temporal-line" data-testid="schedule-detail-next-fire">
        <span className="muted">Next fire</span> <strong>paused</strong>
      </div>
    );
  }
  if (preview === null) {
    return (
      <div className="schedule-detail__temporal-line" data-testid="schedule-detail-next-fire">
        <span className="muted">Next fire</span> <strong>…</strong>
      </div>
    );
  }
  const next = preview.nextRuns[0];
  if (next === undefined) {
    return (
      <div className="schedule-detail__temporal-line" data-testid="schedule-detail-next-fire">
        <span className="muted">Next fire</span> <strong>none upcoming</strong>
      </div>
    );
  }
  return (
    <div className="schedule-detail__temporal-line" data-testid="schedule-detail-next-fire">
      <span className="muted">Next fire</span>{" "}
      <strong title={formatAbsolute(next)}>{formatRelative(next)}</strong>
    </div>
  );
}

/**
 * Header right-column primitive — the last-fired fact. Mirrors
 * {@link ScheduleNextFire}'s layout so the two stack as a compact
 * "temporal facts" block. When the schedule has never fired we keep
 * the same line shape ("Last fired — never") rather than collapsing,
 * for the same right-column-balance reason.
 */
function ScheduleLastFired({ lastFiredAt }: { lastFiredAt: string | null | undefined }) {
  if (!lastFiredAt) {
    return (
      <div className="schedule-detail__temporal-line" data-testid="schedule-detail-last-fired">
        <span className="muted">Last fired</span> <strong>never</strong>
      </div>
    );
  }
  return (
    <div className="schedule-detail__temporal-line" data-testid="schedule-detail-last-fired">
      <span className="muted">Last fired</span>{" "}
      <strong title={formatAbsolute(lastFiredAt)}>{formatRelative(lastFiredAt)}</strong>
    </div>
  );
}
