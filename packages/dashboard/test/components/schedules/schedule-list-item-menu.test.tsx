/**
 * Placement tests for the `ScheduleListItem` row `⋯` menu — the
 * regression suite for the dropdown-clipping fix (issue #112). The
 * measure logic no longer caps `viewportBottom` at the next row's
 * trigger, so an opened menu on a non-last row keeps its full viewport
 * space instead of collapsing to a one-menuitem scrollbox. The flip to
 * `--above` still works — it now keys off the real scroll-container (or
 * window) bottom.
 *
 * happy-dom performs no layout, so geometry is injected via
 * `installRectSpy` (keyed by `data-testid`).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleView } from "../../../src/api";
import { ScheduleListItem } from "../../../src/components/schedules/ScheduleListItem";
import { installRectSpy } from "../../_helpers/rectSpy";

function makeView(overrides: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: "sched-a",
    name: "Sample schedule",
    enabled: true,
    trigger: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    target: {
      kind: "task",
      agent: "official/engineer",
      brief: "Do the thing.",
      runtime: "copilot",
    },
    nextFireAt: "2026-05-30T09:00:00.000Z",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

function makeHandlers() {
  return {
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onToggleEnabled: vi.fn().mockResolvedValue(undefined),
    onRunNow: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    onMenuOpenChange: vi.fn(),
  };
}

type Handlers = ReturnType<typeof makeHandlers>;

function RowList({
  ids,
  openId,
  constrained,
  handlers,
}: {
  ids: string[];
  openId: string | null;
  constrained: boolean;
  handlers: Handlers;
}) {
  const list = (
    <ul>
      {ids.map((id, i) => (
        <ScheduleListItem
          key={id}
          schedule={makeView({ id, name: `Row ${id}` })}
          selected={false}
          onSelect={handlers.onSelect}
          onEdit={handlers.onEdit}
          onToggleEnabled={handlers.onToggleEnabled}
          onRunNow={handlers.onRunNow}
          onDelete={handlers.onDelete}
          busyAction={null}
          menuOpen={openId === id}
          onMenuOpenChange={handlers.onMenuOpenChange}
          posinset={i + 1}
          setsize={ids.length}
        />
      ))}
    </ul>
  );
  return constrained ? (
    <div data-testid="scrollbox" style={{ overflowY: "auto" }}>
      {list}
    </div>
  ) : (
    list
  );
}

/** An opened menu that fits below: rendered `--below`, never clamped, all 5 items present. */
function expectUncappedBelow(panel: HTMLElement) {
  expect(panel.className).toContain("task-list__item-menu-panel--below");
  expect(panel.className).not.toMatch(/task-list__item-menu-panel--above(?:\s|$)/);
  // The panel only sets `--menu-max-height` when it has to clamp; an
  // uncapped menu leaves it unset (equivalent to `maxHeight === null`).
  expect(panel.style.getPropertyValue("--menu-max-height")).toBe("");
  expect(panel.querySelectorAll('[role="menuitem"]').length).toBe(5);
}

afterEach(() => cleanup());

describe("schedule-list-item-menu placement", () => {
  it("opening a non-last row, closing, then opening the next row never clamps either menu", () => {
    // Both rows have a following sibling, so the removed next-row cap
    // would previously have shrunk `spaceBelow` to ~one row height.
    const restore = installRectSpy(
      new Map<string, Partial<DOMRect>>([
        ["schedule-row-menu-trigger-a", { top: 50, bottom: 90, height: 40 }],
        ["schedule-row-menu-trigger-b", { top: 150, bottom: 190, height: 40 }],
        ["schedule-row-menu-trigger-c", { top: 250, bottom: 290, height: 40 }],
        ["schedule-row-menu-trigger-d", { top: 350, bottom: 390, height: 40 }],
        ["schedule-row-menu-b", { height: 200 }],
        ["schedule-row-menu-c", { height: 200 }],
      ]),
    );
    try {
      const handlers = makeHandlers();
      const ids = ["a", "b", "c", "d"];
      const { rerender } = render(
        <RowList ids={ids} openId="b" constrained={false} handlers={handlers} />,
      );
      expectUncappedBelow(screen.getByTestId("schedule-row-menu-b"));

      rerender(<RowList ids={ids} openId={null} constrained={false} handlers={handlers} />);
      expect(screen.queryByTestId("schedule-row-menu-b")).toBeNull();

      rerender(<RowList ids={ids} openId="c" constrained={false} handlers={handlers} />);
      expectUncappedBelow(screen.getByTestId("schedule-row-menu-c"));
    } finally {
      restore();
    }
  });

  it("opening, closing, then re-opening the same row yields an identical uncapped menu", () => {
    const restore = installRectSpy(
      new Map<string, Partial<DOMRect>>([
        ["schedule-row-menu-trigger-a", { top: 50, bottom: 90, height: 40 }],
        ["schedule-row-menu-trigger-b", { top: 150, bottom: 190, height: 40 }],
        ["schedule-row-menu-b", { height: 200 }],
      ]),
    );
    try {
      const handlers = makeHandlers();
      const ids = ["a", "b"];
      const { rerender } = render(
        <RowList ids={ids} openId="b" constrained={false} handlers={handlers} />,
      );
      expectUncappedBelow(screen.getByTestId("schedule-row-menu-b"));

      rerender(<RowList ids={ids} openId={null} constrained={false} handlers={handlers} />);
      expect(screen.queryByTestId("schedule-row-menu-b")).toBeNull();

      rerender(<RowList ids={ids} openId="b" constrained={false} handlers={handlers} />);
      expectUncappedBelow(screen.getByTestId("schedule-row-menu-b"));
    } finally {
      restore();
    }
  });

  it("flips to `--above` for the last row near the bottom of a constrained scroll container", () => {
    // The scroll container is only 300px tall; the last row's trigger
    // sits near its bottom with too little room beneath for the 200px
    // panel, so placement flips above. This is the behaviour the old
    // next-row cap clumsily approximated — now driven by the real
    // container bottom.
    const restore = installRectSpy(
      new Map<string, Partial<DOMRect>>([
        ["scrollbox", { top: 0, bottom: 300, height: 300 }],
        ["schedule-row-menu-trigger-d", { top: 250, bottom: 290, height: 40 }],
        ["schedule-row-menu-d", { height: 200 }],
      ]),
    );
    try {
      const handlers = makeHandlers();
      render(
        <RowList ids={["a", "b", "c", "d"]} openId="d" constrained={true} handlers={handlers} />,
      );
      const panel = screen.getByTestId("schedule-row-menu-d");
      expect(panel.className).toContain("task-list__item-menu-panel--above");
      expect(panel.className).not.toMatch(/task-list__item-menu-panel--below(?:\s|$)/);
    } finally {
      restore();
    }
  });

  it("stays `--below` for a row near the top of a constrained scroll container", () => {
    const restore = installRectSpy(
      new Map<string, Partial<DOMRect>>([
        ["scrollbox", { top: 0, bottom: 300, height: 300 }],
        ["schedule-row-menu-trigger-a", { top: 20, bottom: 60, height: 40 }],
        ["schedule-row-menu-a", { height: 200 }],
      ]),
    );
    try {
      const handlers = makeHandlers();
      render(
        <RowList ids={["a", "b", "c", "d"]} openId="a" constrained={true} handlers={handlers} />,
      );
      const panel = screen.getByTestId("schedule-row-menu-a");
      expect(panel.className).toContain("task-list__item-menu-panel--below");
      expect(panel.className).not.toMatch(/task-list__item-menu-panel--above(?:\s|$)/);
    } finally {
      restore();
    }
  });
});
