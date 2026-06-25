/**
 * Single source of truth for the list-page empty/loading state machine
 * shared by the Tasks, Workflows, Schedules, and Sessions pages.
 *
 * Every page resolves its render branch through {@link resolveListPageState}
 * so the decision tree stays byte-identical across all four surfaces — no
 * per-page divergence can creep in.
 *
 * Decision tree (evaluated in order):
 *
 *   !loaded                                 → "loading"
 *   itemCount === 0  && !filtersActive      → "zero"
 *   itemCount === 0  &&  filtersActive      → "nomatch"
 *   visibleCount === 0                      → "nomatch"
 *   effectiveSelectedId === null            → "unselected"
 *   else                                    → "normal"
 *
 * `itemCount` is the unfiltered list length the page received (drives the
 * genuinely-empty-workspace "zero" vs filter-narrowed "nomatch" split);
 * `visibleCount` is the length after client-side filtering. Sessions is a
 * single-column page and never hits "unselected" (it passes a non-null
 * `effectiveSelectedId` sentinel for any populated list).
 */
export type ListPageState = "loading" | "zero" | "nomatch" | "unselected" | "normal";

export interface ListPageStateInput {
  /** False until the first list fetch settles. */
  loaded: boolean;
  /** Length of the unfiltered list the page received from its data layer. */
  itemCount: number;
  /** True when any filter chrome is constraining the list. */
  filtersActive: boolean;
  /** Length of the list after client-side filtering. */
  visibleCount: number;
  /** The resolved selection, or null when nothing is (or can be) selected. */
  effectiveSelectedId: string | null;
}

export function resolveListPageState({
  loaded,
  itemCount,
  filtersActive,
  visibleCount,
  effectiveSelectedId,
}: ListPageStateInput): ListPageState {
  if (!loaded) return "loading";
  if (itemCount === 0 && !filtersActive) return "zero";
  if (itemCount === 0 && filtersActive) return "nomatch";
  if (visibleCount === 0) return "nomatch";
  if (effectiveSelectedId === null) return "unselected";
  return "normal";
}
