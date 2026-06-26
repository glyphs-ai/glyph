/**
 * Generic master-list loading skeleton for the two-pane list pages
 * (Tasks, Schedules). Renders a small stack of placeholder rows so the
 * rail reserves the same real estate the resolved list will occupy and
 * the chrome doesn't reflow when data lands.
 *
 * Workflows keeps its richer `WorkflowListSkeleton`; this is the calm
 * default for pages that don't need a status-pill row.
 *
 * Reuses the shared `.skeleton` shimmer block — no new animation
 * primitive. The wrapper is a polite `role="status"` live region;
 * decorative bars are `aria-hidden` so the placeholder shapes aren't
 * narrated.
 */
const ROW_COUNT = 4;

export interface ListSkeletonProps {
  ariaLabel: string;
  testId?: string;
  /** Row count override (mostly for tests). Defaults to 4. */
  rowCount?: number;
}

export function ListSkeleton({ ariaLabel, testId, rowCount = ROW_COUNT }: ListSkeletonProps) {
  return (
    <div
      className="list-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <ul className="task-list list-skeleton__list" aria-hidden="true">
        {Array.from({ length: rowCount }, (_, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: stable placeholder rows
            key={i}
            className="task-list__item list-skeleton__row"
          >
            <span className="skeleton list-skeleton__headline" />
            <span className="skeleton list-skeleton__meta" />
            <span className="skeleton list-skeleton__id" />
          </li>
        ))}
      </ul>
    </div>
  );
}
