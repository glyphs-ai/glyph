import { useEffect, useRef } from "react";
import { type ActivityItem, openActivityStream } from "../api";

export interface UseReconnectingStreamOpts {
  /** Task to tail. When null the hook does nothing. */
  taskId: string | null;
  /** When false the hook does nothing (e.g. the task is terminal). */
  enabled: boolean;
  /** Called for each activity item as it arrives on the wire. */
  onItem: (item: ActivityItem) => void;
  /** Called on a per-frame `error` payload or a transport fault. */
  onError?: (err: Error) => void;
}

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Live-tail a task's activity over the typed SDK SSE stream, reconnecting with
 * exponential backoff and `Last-Event-ID` resume.
 *
 * The SDK exposes a one-shot iterator ({@link openActivityStream}); the
 * reconnection policy lives here so the SDK stays pure. A single connection is
 * opened per attempt: while it is live the server's `heartbeat` frames keep
 * intermediaries from idling it out, and each `activity` frame's `id:` (seq)
 * is tracked so a reconnect resumes forward via `Last-Event-ID`. The loop
 * stops for good once the server sends the `end` sentinel (task terminal) or
 * the effect tears down (`enabled` flips false, `taskId` changes, unmount).
 *
 * No-ops when `enabled` is false or `taskId` is null.
 */
export function useReconnectingStream(opts: UseReconnectingStreamOpts): void {
  // Latest-callback ref so a fresh `onItem` / `onError` closure each render
  // doesn't restart the connection loop.
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const { taskId, enabled } = opts;
  useEffect(() => {
    if (!taskId || !enabled) return;

    const controller = new AbortController();
    const { signal } = controller;
    let attempt = 0;
    let lastEventId: string | undefined;

    const run = async () => {
      while (!signal.aborted) {
        const before = lastEventId;
        try {
          const outcome = await openActivityStream(
            taskId,
            {
              onItem: (item) => cbRef.current.onItem(item),
              onError: (err) => cbRef.current.onError?.(err),
            },
            { signal, ...(lastEventId !== undefined ? { lastEventId } : {}) },
          );
          if (outcome.lastEventId !== undefined) lastEventId = outcome.lastEventId;
          if (outcome.ended || signal.aborted) return;
        } catch (err) {
          if (signal.aborted) return;
          cbRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        // Reset backoff when the last connection made progress; otherwise grow
        // it so a persistently-down server isn't hammered.
        attempt = lastEventId !== before ? 0 : attempt + 1;
        await sleep(Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS), signal);
      }
    };
    void run();

    return () => controller.abort();
  }, [taskId, enabled]);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
