import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskActivity, ToolCallActivityItem, UserActivityItem } from "../../../src/api";
import { ActivityRow, ActivityView } from "../../../src/components/tasks/ActivityView";

const noop = vi.fn(() => Promise.resolve());

function makeToolCallItem(
  overrides: Partial<ToolCallActivityItem> = {},
): ToolCallActivityItem {
  return {
    seq: 1,
    timestamp: "2026-06-01T00:00:00Z",
    kind: "tool_call",
    callId: "call-1",
    name: "bash",
    status: "success",
    ...overrides,
  };
}

function makeUserItem(overrides: Partial<UserActivityItem> = {}): UserActivityItem {
  return {
    seq: 1,
    timestamp: "2026-06-01T00:00:00Z",
    kind: "user",
    text: "Hello",
    ...overrides,
  };
}

function makeActivity(items: TaskActivity["activity"]): TaskActivity {
  return { activity: items, result: null, totalItems: items.length };
}

afterEach(() => cleanup());

describe("ActivityView streaming indicator", () => {
  describe("isStreaming={true} renders indicator", () => {
    it("when activity === null and no error", () => {
      render(
        <ActivityView
          activity={null}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={true}
        />,
      );
      expect(screen.getByText("Agent working…")).toBeTruthy();
    });

    it("when activity.activity.length === 0", () => {
      render(
        <ActivityView
          activity={makeActivity([])}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={true}
        />,
      );
      expect(screen.getByText("Agent working…")).toBeTruthy();
    });

    it("when activity has items", () => {
      render(
        <ActivityView
          activity={makeActivity([makeUserItem()])}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={true}
        />,
      );
      expect(screen.getByText("Agent working…")).toBeTruthy();
    });
  });

  describe("isStreaming={false} does NOT render indicator", () => {
    it("when activity === null and no error", () => {
      render(
        <ActivityView
          activity={null}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={false}
        />,
      );
      expect(screen.queryByText("Agent working…")).toBeNull();
    });

    it("when activity.activity.length === 0", () => {
      render(
        <ActivityView
          activity={makeActivity([])}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={false}
        />,
      );
      expect(screen.queryByText("Agent working…")).toBeNull();
    });

    it("when activity has items", () => {
      render(
        <ActivityView
          activity={makeActivity([makeUserItem()])}
          activityError={null}
          onLoadOlder={noop}
          isStreaming={false}
        />,
      );
      expect(screen.queryByText("Agent working…")).toBeNull();
    });
  });

  it("activity === null with activityError does NOT render indicator", () => {
    render(
      <ActivityView
        activity={null}
        activityError="connection failed"
        onLoadOlder={noop}
        isStreaming={true}
      />,
    );
    expect(screen.queryByText("Agent working…")).toBeNull();
  });
});

describe("ANSI rendering in ActivityRow", () => {
  it("renders ANSI-colored text as styled spans, not raw escape codes", () => {
    const item = makeToolCallItem({
      display: { content: "\x1b[31mhello\x1b[0m world" },
    });
    const { container } = render(<ActivityRow item={item} />);
    // No raw escape codes in text content
    expect(container.textContent).not.toContain("\x1b");
    // "hello" should be wrapped in a span with inline color style
    const helloEl = screen.getByText("hello");
    expect(helloEl.tagName.toLowerCase()).toBe("span");
    expect(helloEl.style.color).toBeTruthy();
  });
});

describe("ToolDisplay ANSI-safe preview truncation", () => {
  it("strips ANSI from preview without leaking partial escape codes", () => {
    // Build content with ANSI codes near the 240-char boundary
    const prefix = "x".repeat(235);
    // Place an ANSI escape right at char 235-240 boundary
    const content = `${prefix}\x1b[31mRED_TEXT\x1b[0m and more content that goes well beyond the preview limit to ensure truncation happens`;
    const item = makeToolCallItem({ display: { content } });
    const { container } = render(<ActivityRow item={item} />);
    // The preview text should not contain raw escape sequences
    const textContent = container.textContent ?? "";
    expect(textContent).not.toContain("\x1b");
    expect(textContent).not.toContain("[31m");
  });
});
