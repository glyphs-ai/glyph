import type { ReactNode } from "react";
import type { TaskFailure, TaskRecord } from "../../../api";
import { MarkdownSummary } from "./MarkdownSummary";

export interface OverviewTabProps {
  task: TaskRecord;
  /** Switch the parent detail panel to another tab. Used by the
   *  "Jump to Activity" link on the failure callout and no-summary note. */
  onSwitchTab: (tab: "activity") => void;
}

/**
 * Overview tab — the default landing tab for a task.
 *
 * Layout: vertical stack of (optional) state strip + Summary card +
 * Details card. Summary holds `success.output`; Details
 * holds the submitted `task.details` brief. Metadata (Started, Duration,
 * Origin, Task ID) is intentionally not rendered here — the parent
 * `TaskDetail` head already shows it.
 *
 * Five layout states:
 *   1. Succeeded + output non-empty → Summary + Details (50/50, both scroll)
 *   2. Succeeded + output empty     → "No summary" note + Details
 *   3. Failed                       → Failure callout + Details
 *   4. Cancelled                    → Cancellation note + Details
 *   5. Running / queued / pending   → "Switch to Activity" note + Details
 *
 * Height layout: the tab body fills the parent's height via flex; each
 * present card gets `flex: 1` with `min-height: 0` so its inner content
 * scrolls independently. When both Summary and Details are present they
 * share the space 50/50; otherwise Details fills the remaining height.
 */
export function OverviewTab({ task, onSwitchTab }: OverviewTabProps) {
  const output = typeof task.success?.output === "string" ? task.success.output.trim() : "";
  const hasSummary = output.length > 0;
  const details = task.details?.trim() ?? "";
  const hasDetails = details.length > 0;

  const strip = renderStateStrip({ task, onSwitchTab, hasSummary });

  return (
    <div className="overview-tab">
      {strip}
      {hasSummary && (
        <OverviewCard title="Summary" className="overview-card--summary">
          <MarkdownSummary source={output} />
        </OverviewCard>
      )}
      {hasDetails ? (
        <OverviewCard title="Details" className="overview-card--details">
          <pre className="overview-card__pre">{details}</pre>
        </OverviewCard>
      ) : (
        !hasSummary &&
        strip === null && <p className="overview-tab__no-details muted">No details available.</p>
      )}
    </div>
  );
}

/**
 * Pick the contextual strip rendered above the cards. Returns `null`
 * for the succeeded-with-output state — that state is "pure result, no
 * commentary needed".
 */
function renderStateStrip({
  task,
  onSwitchTab,
  hasSummary,
}: {
  task: TaskRecord;
  onSwitchTab: (tab: "activity") => void;
  hasSummary: boolean;
}): ReactNode {
  if (task.failure) {
    return <FailureStrip failure={task.failure} onSwitchTab={onSwitchTab} />;
  }
  if (task.cancellation) {
    return (
      <div className="alert alert--info overview-tab__strip">
        {task.cancellation.message || "Task was cancelled."}
      </div>
    );
  }
  if (task.status === "succeeded") {
    if (hasSummary) return null;
    return (
      <p className="overview-tab__no-summary">
        No summary was produced. View the{" "}
        <button type="button" className="link-button" onClick={() => onSwitchTab("activity")}>
          Activity tab
        </button>{" "}
        for the full agent run.
      </p>
    );
  }
  // Running / queued / pending.
  return (
    <div className="alert alert--info overview-tab__strip overview-tab__running-hint">
      Task is {task.status}. Switch to the{" "}
      <button type="button" className="link-button" onClick={() => onSwitchTab("activity")}>
        Activity tab
      </button>{" "}
      to follow activity.
    </div>
  );
}

/**
 * Pinned-title card with an internally-scrolling body. Both Summary and
 * Details share this chrome so they read as equals.
 */
function OverviewCard({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`overview-card${className ? ` ${className}` : ""}`}>
      <header className="overview-card__head">
        <h3 className="overview-card__title">{title}</h3>
      </header>
      <div className="overview-card__body">{children}</div>
    </section>
  );
}

/**
 * Render a failure callout with a one-line headline + the structured
 * `failure` payload. The `execution` kind shows an exit-code or signal chip
 * when the field is present.
 */
function FailureStrip({
  failure,
  onSwitchTab,
}: {
  failure: TaskFailure;
  onSwitchTab: (tab: "activity") => void;
}) {
  return (
    <div className="alert alert--error overview-tab__failure-callout">
      <div className="overview-tab__failure-head">
        <strong>Failure · {failure.kind}</strong>
        {failure.kind === "execution" && failure.exitCode !== undefined && (
          <span className="overview-tab__failure-chip">exit {failure.exitCode}</span>
        )}
        {failure.kind === "execution" && failure.signal !== undefined && (
          <span className="overview-tab__failure-chip">signal {failure.signal}</span>
        )}
      </div>
      <p className="overview-tab__failure-message">{failure.message}</p>
      <div className="overview-tab__failure-actions">
        <button type="button" className="link-button" onClick={() => onSwitchTab("activity")}>
          Jump to Activity ↗
        </button>
      </div>
    </div>
  );
}
