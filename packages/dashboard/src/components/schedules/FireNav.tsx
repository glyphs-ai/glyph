/**
 * Mode-B fire-navigation chrome shared by the Schedules-page detail
 * panes (`FireTaskDetailPane`, `FireWorkflowDetailPane`). Both panes
 * walk a schedule's recent-fires list, so the back chip + ‹ N/M ›
 * sibling walker is identical regardless of whether each fire is a
 * task or a workflow — only the body the pill sits beside differs.
 *
 * The data-testids / CSS classes keep the `fire-task-nav*` namespace
 * the task pane shipped with so existing selectors and `styles.css`
 * rules apply unchanged to both panes.
 */

export interface FallbackBackRowProps {
  scheduleName: string;
  onBack: () => void;
}

/**
 * Minimal back-only row used when there is no fire in scope to
 * navigate within (loading, fetch error, or fire-not-found). The
 * success path uses {@link FireNavPill} inside the detail title row
 * instead, so this fallback row only ever shows during transient or
 * error states.
 */
export function FallbackBackRow({ scheduleName, onBack }: FallbackBackRowProps) {
  return (
    <nav
      className="fire-task-nav fire-task-nav--fallback"
      aria-label="Fire navigation"
      data-testid="fire-task-nav"
    >
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onBack}
        data-testid="fire-task-back"
        title={`Back to ${scheduleName}`}
      >
        ← Back to {scheduleName}
      </button>
    </nav>
  );
}

export interface FireNavPillProps {
  scheduleName: string;
  position: number;
  total: number;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

/**
 * Compact navigation pill rendered in the detail view's title-row
 * trailing slot. Shape: `[← {scheduleName}] · [‹ N/M ›]`. The back chip
 * and the sibling-nav cluster are visually separated by a hairline
 * divider but share one container so screenreaders see a single group.
 *
 * The position indicator `N / M` reflects rank in the in-memory recent-
 * fires array at query time. When new fires arrive at the top via
 * polling, the same selected fire can silently shift from `3 / 10` to
 * `4 / 11`. We use `aria-label="position N of latest M"` instead of
 * `aria-live` to avoid jarring announcements; users can re-orient by
 * clicking ← Back to refresh the list.
 */
export function FireNavPill({
  scheduleName,
  position,
  total,
  onBack,
  onPrev,
  onNext,
}: FireNavPillProps) {
  return (
    <nav className="fire-task-nav" aria-label="Fire navigation" data-testid="fire-task-nav">
      <button
        type="button"
        className="fire-task-nav__back"
        onClick={onBack}
        data-testid="fire-task-back"
        title={`Back to ${scheduleName}`}
      >
        <span aria-hidden="true">← </span>
        <span className="fire-task-nav__back-label">{scheduleName}</span>
      </button>
      <span className="fire-task-nav__sep" aria-hidden="true" />
      <button
        type="button"
        className="fire-task-nav__step"
        onClick={onPrev ?? undefined}
        disabled={onPrev === null}
        data-testid="fire-task-prev"
        aria-label={`Previous fire (newer; currently ${position} of latest ${total})`}
        title="Previous fire (newer)"
      >
        ‹
      </button>
      <span className="fire-task-nav__pos" data-testid="fire-task-position">
        {position} / {total}
      </span>
      <button
        type="button"
        className="fire-task-nav__step"
        onClick={onNext ?? undefined}
        disabled={onNext === null}
        data-testid="fire-task-next"
        aria-label={`Next fire (older; currently ${position} of latest ${total})`}
        title="Next fire (older)"
      >
        ›
      </button>
    </nav>
  );
}
