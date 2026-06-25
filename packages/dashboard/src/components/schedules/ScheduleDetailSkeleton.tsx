/**
 * Loading skeleton for the Schedules detail right-pane. A calm shimmer
 * card that reserves the detail pane's real estate during the initial
 * per-schedule fetch, so the pane doesn't sit blank while the rail
 * shows its own skeleton.
 *
 * Shares the `.detail-skeleton` CSS with `TaskDetailSkeleton` and reuses
 * the existing `.skeleton` shimmer — no new animation primitive.
 */
export function ScheduleDetailSkeleton() {
  return (
    <aside
      className="tasks-pane__detail detail-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading schedule"
      data-testid="schedule-detail-skeleton"
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
