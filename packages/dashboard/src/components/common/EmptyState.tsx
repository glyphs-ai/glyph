import type { ReactNode } from "react";

/**
 * Shared empty / zero / no-match panel for the dashboard list pages
 * (Tasks, Workflows, Schedules, Sessions). One component, one card
 * shape, so every page's empty messaging is visually identical.
 *
 * - Reuses the established `.empty` card primitive (icon / title / hint)
 *   so it matches the Agents page and the rest of the app.
 * - `cta.variant` maps to the button style: "primary" → accent
 *   `btn--primary` (Dispatch / New …), "secondary" → the neutral
 *   bordered `btn` (Clear filters).
 * - `asDetailPane` wraps the card in the `.tasks-pane__detail--empty`
 *   aside so two-pane pages can drop it straight into the right column;
 *   single-column pages (Sessions) omit it and render the bare card.
 */
export type CtaVariant = "primary" | "secondary";

export interface EmptyStateCta {
  label: string;
  onClick: () => void;
  /** Button style. Defaults to "primary". */
  variant?: CtaVariant;
  disabled?: boolean;
  /** `title` attribute on the button (e.g. why it is disabled). */
  disabledTitle?: string;
  /** Leading icon node, e.g. `<PlusIcon />`. */
  icon?: ReactNode;
  testId?: string;
}

export interface EmptyStateProps {
  /** Emoji string (📝, 🪄, 📅, 📂, 🔍) or any React node. */
  icon: ReactNode;
  title: string;
  /** ReactNode so callers can embed `<code>`, `<strong>`, etc. */
  hint?: ReactNode;
  cta?: EmptyStateCta;
  testId?: string;
  /**
   * When true, renders inside the `.tasks-pane__detail--empty` aside
   * wrapper used by the two-pane pages. Default false (bare card).
   */
  asDetailPane?: boolean;
}

export function EmptyState({
  icon,
  title,
  hint,
  cta,
  testId,
  asDetailPane = false,
}: EmptyStateProps) {
  const ctaClassName = ["btn", cta?.variant === "secondary" ? null : "btn--primary", "empty__cta"]
    .filter(Boolean)
    .join(" ");

  const card = (
    // `role="status"` makes the card a polite live region so a no-match /
    // zero transition (e.g. a filter collapsing the list) is announced to
    // screen-reader users, matching the loading skeletons' announcement.
    <div className="empty" role="status" data-testid={testId}>
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty__title">{title}</p>
      {hint != null && <p className="empty__hint">{hint}</p>}
      {cta && (
        <button
          type="button"
          className={ctaClassName}
          onClick={cta.onClick}
          disabled={cta.disabled}
          title={cta.disabledTitle}
          data-testid={cta.testId}
        >
          {cta.icon}
          <span>{cta.label}</span>
        </button>
      )}
    </div>
  );

  if (asDetailPane) {
    return <aside className="tasks-pane__detail tasks-pane__detail--empty">{card}</aside>;
  }
  return card;
}
