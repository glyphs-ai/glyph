/**
 * Unit tests for `followTaskActivity` — the SSE consumer used by
 * `glyph task activity <task-id> --follow`.
 *
 * `followTaskActivity` drives the typed `@glyphs-ai/sdk` stream operation
 * (`getApiWorkspacesByIdTasksByTidActivityStream`), routing each frame on its
 * SSE `event:` name via the operation's `onSseEvent` callback. These tests
 * mock that operation with a scripted async generator that replays frames
 * (invoking `onSseEvent` / `onSseError` exactly as the real runtime does) and
 * assert:
 *  - `Last-Event-ID` is sent iff the caller passes `after`, and the stream is
 *    opened one-shot (`sseMaxRetryAttempts: 1`).
 *  - Each activity frame prints its own NDJSON line; heartbeats are ignored.
 *  - `event: end` exits 0; `event: error` exits 1 with stderr; a transport
 *    fault exits 1.
 *  - Whenever a frame carried `id:`, the result's stderr ends with
 *    `last seq: <N>` so the user can resume next time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Frame {
  readonly event?: string;
  readonly id?: string;
  readonly data?: unknown;
  /** When set, the frame is delivered via `onSseError` (a transport fault). */
  readonly errorMessage?: string;
}

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  frames: [] as Frame[],
}));

vi.mock("@glyphs-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphs-ai/sdk")>();
  return {
    ...actual,
    // biome-ignore lint/suspicious/noExplicitAny: test double mirrors the op's runtime surface.
    getApiWorkspacesByIdTasksByTidActivityStream: (options: any) => {
      h.calls.push(options);
      const frames = h.frames;
      async function* stream() {
        for (const f of frames) {
          if (f.errorMessage !== undefined) {
            options.onSseError?.(new Error(f.errorMessage));
            continue;
          }
          options.onSseEvent?.({ data: f.data, event: f.event, id: f.id });
          yield f.data;
        }
      }
      return Promise.resolve({ stream: stream() });
    },
  };
});

import { followTaskActivity } from "../../src/commands/task.js";

function setFrames(frames: Frame[]): void {
  h.frames = frames;
}

function activityFrame(seq: number, payload: object): Frame {
  return { event: "activity", id: String(seq), data: { seq, ...payload } };
}

beforeEach(() => {
  h.calls = [];
  h.frames = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("followTaskActivity", () => {
  it("opens the stream one-shot and sends no Last-Event-ID without `after`", async () => {
    setFrames([{ event: "end", data: {} }]);
    const r = await followTaskActivity("ws-1", "20260601-abcd1234");
    expect(r.exitCode).toBe(0);
    expect(h.calls[0]?.path).toEqual({ id: "ws-1", tid: "20260601-abcd1234" });
    expect(h.calls[0]?.sseMaxRetryAttempts).toBe(1);
    expect(h.calls[0]?.headers).toBeUndefined();
  });

  it("sends Last-Event-ID: <after> when `after` is provided", async () => {
    setFrames([{ event: "end", data: {} }]);
    await followTaskActivity("ws-1", "20260601-abcd1234", { after: 1234 });
    expect(h.calls[0]?.headers).toEqual({ "Last-Event-ID": "1234" });
  });

  it("emits one NDJSON line per activity frame and exits 0 on `end`", async () => {
    setFrames([
      activityFrame(1, { kind: "stdout", text: "hello" }),
      activityFrame(2, { kind: "stdout", text: "world" }),
      { event: "end", data: {} },
    ]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(0);
    const lines = (r.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ seq: 1, text: "hello" });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ seq: 2, text: "world" });
  });

  it("ignores heartbeat frames (no output, no early exit)", async () => {
    setFrames([
      { event: "heartbeat", data: {} },
      activityFrame(3, { kind: "stdout", text: "after beat" }),
      { event: "heartbeat", data: {} },
      { event: "end", data: {} },
    ]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(0);
    const lines = (r.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ seq: 3, text: "after beat" });
  });

  it("appends `last seq: <N>` to stderr after a clean end", async () => {
    // The server's `end` frame carries no `id:`; the resume hint is the last
    // activity's seq (`lastSeq` retains the highest seq seen).
    setFrames([
      activityFrame(7, { kind: "stdout", text: "x" }),
      activityFrame(8, { kind: "stdout", text: "y" }),
      { event: "end", data: {} },
    ]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("last seq: 8\n");
  });

  it("seeds lastSeq from the resume `after` when no frames carry id", async () => {
    setFrames([{ event: "end", data: {} }]);
    const r = await followTaskActivity("ws-1", "tid", { after: 42 });
    expect(r.stderr).toBe("last seq: 42\n");
  });

  it("does NOT print a resume hint when no `after` and no frames had id", async () => {
    setFrames([{ event: "end", data: {} }]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(0);
    expect(r.stderr ?? "").toBe("");
  });

  it("event: error exits 1, surfaces server message, and still prints last seq", async () => {
    setFrames([
      activityFrame(5, { kind: "stdout", text: "before fault" }),
      { event: "error", data: { error: "runtime crashed" } },
    ]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("stream error:");
    expect(r.stderr).toContain("runtime crashed");
    expect(r.stderr).toContain("last seq: 5");
  });

  it("maps a 404 connection failure to a helpful message with no resume hint", async () => {
    setFrames([{ errorMessage: "SSE failed: 404 Not Found" }]);
    const r = await followTaskActivity("ws-1", "missing", { after: 99 });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("no streaming activity");
    expect(r.stderr).not.toContain("last seq:");
  });

  it("exits 1 with a resume hint when the connection drops mid-stream", async () => {
    setFrames([
      activityFrame(11, { kind: "stdout", text: "split" }),
      { errorMessage: "SSE failed: 503 Service Unavailable" },
    ]);
    const r = await followTaskActivity("ws-1", "tid");
    expect(r.exitCode).toBe(1);
    const lines = (r.stdout ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ seq: 11, text: "split" });
    expect(r.stderr).toContain("stream connection failed");
    expect(r.stderr).toContain("last seq: 11");
  });
});
