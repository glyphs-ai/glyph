import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../../src/hooks/useCopyToClipboard";

// Make the underlying clipboard write succeed so `copy()` arms the
// reset timer. The hook composes this primitive; the write path itself
// is covered by the clipboard util's own tests.
vi.mock("../../src/utils/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// resetMs is deliberately a distinctive value so the armed reset timer
// can be told apart from any timer React's scheduler arms internally.
const RESET_MS = 1234;

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the pending reset timer on unmount", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const { result, unmount } = renderHook(() => useCopyToClipboard(RESET_MS));
    await act(async () => {
      await result.current.copy("payload");
    });
    expect(result.current.copied).toBe(true);

    // The reset timer is the one armed at RESET_MS; capture its id.
    const armedIndex = setSpy.mock.calls.findIndex((args) => args[1] === RESET_MS);
    expect(armedIndex).toBeGreaterThanOrEqual(0);
    const timerId = setSpy.mock.results[armedIndex]?.value;

    unmount();

    // The unmount cleanup must clear exactly that pending timer, so a
    // reset fired after navigation cannot setState on an unmounted hook.
    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });

  it("does not clear any timer on unmount when no copy is pending", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = renderHook(() => useCopyToClipboard(RESET_MS));
    unmount();

    // timerRef starts null, so the cleanup guard skips clearTimeout.
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
