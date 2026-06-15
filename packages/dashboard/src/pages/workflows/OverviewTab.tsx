import type { ReactNode } from "react";
import type { WorkflowDagWire, WorkflowHeaderWire, WorkflowNodeWire } from "../../api";
import { MarkdownSummary } from "../../components/tasks/TaskDetail/MarkdownSummary";

export interface OverviewTabProps {
  workflow: WorkflowHeaderWire;
  dag?: WorkflowDagWire | null;
  onGoToHumanNode?: (node: WorkflowNodeWire) => void;
}

/**
 * Overview tab — workflow narrative.
 *
 * Layout: vertical stack of (optional) state strip + Summary card +
 * Details card. Mirrors `components/tasks/TaskDetail/OverviewTab.tsx`
 * so users moving between the Task and Workflow detail panes find the
 * same chrome.
 *
 *   - Summary holds `success.output` (the coordinator's free-form
 *     terminal summary). Rendered through {@link MarkdownSummary} so
 *     headings / lists / inline code in the coord's output show up.
 *   - Details holds the submitted `workflow.details` brief from
 *     creation time. Rendered as `<pre>` (matches task's Details
 *     card) so whitespace-sensitive operator notes stay legible.
 *   - State strip is conditional: typed failure callout for `failed`,
 *     muted info note for `cancelled`, "Run succeeded with no recorded
 *     summary" for succeeded-without-output, "Run ended; no payload"
 *     for terminal rows missing their typed payload, running hint for
 *     in-flight.
 *
 * The `brief` now lives only in `WorkflowView`'s
 * `<h2 class="workflow-detail__title">` (the
 * page title), so we don't repeat the same string twice in the same
 * pane.
 *
 * Header chrome (status badge, meta chips) lives in the parent
 * {@link import("./WorkflowView").WorkflowView} so the tab body stays
 * purely about the workflow's narrative.
 */
export function OverviewTab({ workflow, dag, onGoToHumanNode }: OverviewTabProps) {
  const summaryText =
    typeof workflow.success?.output === "string" ? workflow.success.output.trim() : "";
  const hasSummary = summaryText.length > 0;
  const detailsText = workflow.details?.trim() ?? "";
  const hasDetails = detailsText.length > 0;
  const metadataEntries = Object.entries(workflow.metadata ?? {});
  const hasMetadata = metadataEntries.length > 0;

  const strip = renderStateStrip({ workflow, hasSummary, dag, onGoToHumanNode });

  return (
    <div className="overview-tab" data-testid="workflow-overview-tab">
      {strip}
      {hasSummary && (
        <OverviewCard title="Summary" className="overview-card--summary">
          <div data-testid="workflow-overview-summary">
            <MarkdownSummary source={summaryText} />
          </div>
        </OverviewCard>
      )}
      {hasDetails && (
        <OverviewCard title="Details" className="overview-card--details">
          <pre className="overview-card__pre" data-testid="workflow-overview-details">
            {detailsText}
          </pre>
        </OverviewCard>
      )}
      {hasMetadata && (
        <OverviewCard title="Metadata" className="overview-card--metadata">
          <dl className="workflow-overview__metadata" data-testid="workflow-overview-metadata">
            {metadataEntries.map(([key, value]) => (
              <div className="workflow-overview__meta-row" key={key}>
                <dt>{key}</dt>
                <dd>
                  <code>{stringifyValue(value)}</code>
                </dd>
              </div>
            ))}
          </dl>
        </OverviewCard>
      )}
      {!hasSummary && !hasDetails && !hasMetadata && strip === null && (
        <p className="overview-tab__no-details muted" data-testid="workflow-overview-empty">
          No details available.
        </p>
      )}
    </div>
  );
}

/**
 * Pick the contextual strip rendered above the cards. Returns `null`
 * for the succeeded-with-output state — that state is "pure result,
 * no commentary needed".
 *
 * Branch table:
 *   - failed + failure → typed FailureStrip
 *   - cancelled + cancellation → cancellation note
 *   - succeeded + hasSummary → null
 *   - succeeded + no summary → "Run succeeded with no recorded summary"
 *   - terminal + payload missing → missing-payload note
 *   - running → "switch to Activity / Graph" hint
 */
function renderStateStrip({
  workflow,
  hasSummary,
  dag,
  onGoToHumanNode,
}: {
  workflow: WorkflowHeaderWire;
  hasSummary: boolean;
  dag?: WorkflowDagWire | null;
  onGoToHumanNode?: (node: WorkflowNodeWire) => void;
}): ReactNode {
  if (workflow.status === "failed") {
    if (workflow.failure) {
      return <FailureStrip failure={workflow.failure} />;
    }
    return (
      <div
        className="alert alert--info overview-tab__strip"
        data-testid="workflow-overview-missing-payload-note"
      >
        Run ended; no payload was recorded.
      </div>
    );
  }
  if (workflow.status === "cancelled") {
    if (workflow.cancellation) {
      const message = workflow.cancellation.message || "Workflow was cancelled.";
      return (
        <div
          className="alert alert--info overview-tab__strip"
          data-testid="workflow-overview-cancellation"
        >
          {message}
        </div>
      );
    }
    return (
      <div
        className="alert alert--info overview-tab__strip"
        data-testid="workflow-overview-missing-payload-note"
      >
        Run ended; no payload was recorded.
      </div>
    );
  }
  if (workflow.status === "succeeded") {
    if (hasSummary) return null;
    if (workflow.success === undefined) {
      // Use the same alert chrome as failed/cancelled missing-payload
      // states so terminal rows with no typed result look consistent.
      return (
        <div
          className="alert alert--info overview-tab__strip"
          data-testid="workflow-overview-missing-payload-note"
        >
          Run ended; no payload was recorded.
        </div>
      );
    }
    return (
      <p className="overview-tab__no-summary" data-testid="workflow-overview-no-summary">
        Run succeeded with no recorded summary.
      </p>
    );
  }
  // Running.
  if (workflow.awaitingHumanCount > 0) {
    const count = workflow.awaitingHumanCount;
    const firstHumanNode =
      dag?.nodes.find((n) => n.spec.kind === "human" && n.status === "running") ?? null;
    const message =
      count === 1
        ? "1 human node is waiting for your input."
        : `${count} human nodes are waiting for your input.`;
    return (
      <div
        className="alert alert--warn overview-tab__strip overview-tab__running-hint"
        data-testid="workflow-overview-awaiting-hint"
      >
        <span>{message}</span>
        {firstHumanNode && onGoToHumanNode && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="workflow-overview-go-to-node"
            onClick={() => onGoToHumanNode(firstHumanNode)}
          >
            {count > 1 ? "Open first node →" : "Open node →"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className="alert alert--info overview-tab__strip overview-tab__running-hint"
      data-testid="workflow-overview-running-hint"
    >
      Workflow is {workflow.status}. Switch to the Graph tab to watch nodes light up, or Activity on
      a node for live runtime output.
    </div>
  );
}

/**
 * Pinned-title card with an internally-scrolling body. Shared chrome
 * between Summary / Details / Metadata so all three read as equals.
 * Reuses the same `.overview-card*` selectors that the Task detail
 * pane defines, so the visual treatment lines up exactly.
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
 * Render a workflow failure callout with `failure.kind` chip + the
 * substrate- or coordinator-supplied message. Mirrors the Task
 * `FailureStrip` shape but specialised for `WorkflowFailureWire`.
 */
function FailureStrip({ failure }: { failure: NonNullable<WorkflowHeaderWire["failure"]> }) {
  return (
    <div
      className="alert alert--error overview-tab__failure-callout"
      data-testid="workflow-overview-failure-callout"
    >
      <div className="overview-tab__failure-head">
        <strong>Failure · {failure.kind}</strong>
      </div>
      <p className="overview-tab__failure-message" data-testid="workflow-overview-failure-message">
        {failure.message}
      </p>
    </div>
  );
}

function stringifyValue(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
