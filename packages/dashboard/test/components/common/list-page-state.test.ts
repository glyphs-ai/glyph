import { describe, expect, it } from "vitest";
import {
  type ListPageStateInput,
  resolveListPageState,
} from "../../../src/components/common/listPageState";

/**
 * Exhaustive coverage of the shared list-page decision tree. The four
 * list pages (Tasks / Workflows / Schedules / Sessions) all funnel their
 * render branch through this resolver, so locking every state by name
 * here guarantees no page can diverge from the shared empty-state matrix.
 */
describe("resolveListPageState — shared list-page decision tree", () => {
  const base: ListPageStateInput = {
    loaded: true,
    itemCount: 3,
    filtersActive: false,
    visibleCount: 3,
    effectiveSelectedId: "row-1",
  };

  it("loading: an unsettled list fetch wins over every other signal", () => {
    expect(resolveListPageState({ ...base, loaded: false })).toBe("loading");
    // Even a zero + filtered + unselected combination stays "loading".
    expect(
      resolveListPageState({
        loaded: false,
        itemCount: 0,
        filtersActive: true,
        visibleCount: 0,
        effectiveSelectedId: null,
      }),
    ).toBe("loading");
  });

  it("zero: loaded, no items, and no filter constraining the list", () => {
    expect(
      resolveListPageState({
        ...base,
        itemCount: 0,
        visibleCount: 0,
        filtersActive: false,
        effectiveSelectedId: null,
      }),
    ).toBe("zero");
  });

  it("nomatch: loaded with no items but a filter is active", () => {
    expect(
      resolveListPageState({
        ...base,
        itemCount: 0,
        visibleCount: 0,
        filtersActive: true,
        effectiveSelectedId: null,
      }),
    ).toBe("nomatch");
  });

  it("nomatch: items exist server-side but the client filter hides them all", () => {
    expect(
      resolveListPageState({
        ...base,
        itemCount: 5,
        visibleCount: 0,
        filtersActive: true,
        effectiveSelectedId: null,
      }),
    ).toBe("nomatch");
  });

  it("unselected: visible rows exist but nothing resolved as selected", () => {
    expect(resolveListPageState({ ...base, effectiveSelectedId: null })).toBe("unselected");
  });

  it("normal: visible rows with a resolved selection", () => {
    expect(resolveListPageState(base)).toBe("normal");
  });
});
