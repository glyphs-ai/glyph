/**
 * Loading skeleton for the right-hand detail pane on the two-pane list
 * pages (Tasks, Schedules). A calm shimmer card (title + two meta chips +
 * a few body lines) that reserves the detail pane's real estate during the
 * initial per-item fetch, so the pane doesn't sit blank while the rail
 * shows its own skeleton.
 *
 * Workflows keeps its richer `WorkflowDetailSkeleton` (statbar + tabs); this
 * is the calm default for panes that don't need that extra structure.
 *
 * Reuses the shared `.detail-skeleton` / `.skeleton` shimmer — no new
 * animation primitive. The wrapper is a polite `role="status"` live region;
 * the decorative bars are `aria-hidden` so the placeholder shapes aren't
 * narrated.
 */
export interface DetailSkeletonProps {
  ariaLabel: string;
  testId: string;
}

export function DetailSkeleton({ ariaLabel, testId }: DetailSkeletonProps) {
  return (
    <aside
      className="tasks-pane__detail detail-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <div className="detail-skeleton__inner" aria-hidden="true">
        <span className="skeleton detail-skeleton__title" />
        <div className="detail-skeleton__meta-row">
          <span className="skeleton detail-skeleton__chip" />
          <span className="skeleton detail-skeleton__chip detail-skeleton__chip--wide" />
        </div>
        <div className="detail-skeleton__body">
          <span className="skeleton detail-skeleton__line detail-skeleton__line--long" />
          <span className="skeleton detail-skeleton__line detail-skeleton__line--med" />
          <span className="skeleton detail-skeleton__line detail-skeleton__line--short" />
          <span className="skeleton detail-skeleton__line detail-skeleton__line--med" />
        </div>
      </div>
    </aside>
  );
}
