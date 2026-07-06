import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "../../src/api";

vi.mock("../../src/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/api")>("../../src/api");
  return { ...actual, openActivityStream: vi.fn() };
});

import * as api from "../../src/api";
import { useReconnectingStream } from "../../src/hooks/useReconnectingStream";

const mockOpen = api.openActivityStream as unknown as ReturnType<typeof vi.fn>;

const item = (seq: number): ActivityItem =>
  ({
    seq,
    kind: "user",
    text: "hi",
    timestamp: "2026-06-01T00:00:00.000Z",
  }) as unknown as ActivityItem;

type Opts = { signal: AbortSignal; lastEventId?: string };
const optsOf = (call: number): Opts => mockOpen.mock.calls[call][2] as Opts;

beforeEach(() => {
  mockOpen.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectingStream", () => {
  it("does nothing when disabled", () => {
    renderHook(() => useReconnectingStream({ taskId: "t1", enabled: false, onItem: vi.fn() }));
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("does nothing when taskId is null", () => {
    renderHook(() => useReconnectingStream({ taskId: null, enabled: true, onItem: vi.fn() }));
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("opens one connection, forwards items, and stops after the end sentinel", async () => {
    mockOpen.mockImplementation(
      async (_taskId: string, cbs: { onItem: (i: ActivityItem) => void }) => {
        cbs.onItem(item(1));
        return { lastEventId: "1", ended: true };
      },
    );
    const onItem = vi.fn();
    renderHook(() => useReconnectingStream({ taskId: "t1", enabled: true, onItem }));

    await waitFor(() => expect(onItem).toHaveBeenCalledWith(item(1)));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    // First connection opens with no resume cursor.
    expect(optsOf(0).signal).toBeInstanceOf(AbortSignal);
    expect(optsOf(0).lastEventId).toBeUndefined();

    // The `end` sentinel is terminal — no reconnect on a later tick.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("reconnects with Last-Event-ID after a dropped (non-ended) connection", async () => {
    vi.useFakeTimers();
    mockOpen
      .mockImplementationOnce(async (_t: string, cbs: { onItem: (i: ActivityItem) => void }) => {
        cbs.onItem(item(5));
        return { lastEventId: "5", ended: false };
      })
      .mockImplementationOnce(async () => ({ lastEventId: "5", ended: true }));
    renderHook(() => useReconnectingStream({ taskId: "t1", enabled: true, onItem: vi.fn() }));

    // Flush the first connection attempt (resolves, parks on backoff).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(optsOf(0).lastEventId).toBeUndefined();

    // Progress was made → backoff reset to 1s. Advancing it drives the
    // reconnect, which resumes forward via the seen seq.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(optsOf(1).lastEventId).toBe("5");
  });

  it("aborts the in-flight connection when the effect tears down", async () => {
    let captured: AbortSignal | undefined;
    mockOpen.mockImplementation(async (_t: string, _cbs: unknown, opts: Opts) => {
      captured = opts.signal;
      await new Promise<void>((r) =>
        opts.signal.addEventListener("abort", () => r(), { once: true }),
      );
      return { lastEventId: undefined, ended: false };
    });
    const { unmount } = renderHook(() =>
      useReconnectingStream({ taskId: "t1", enabled: true, onItem: vi.fn() }),
    );

    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));
    expect(captured?.aborted).toBe(false);
    unmount();
    expect(captured?.aborted).toBe(true);
  });
});
