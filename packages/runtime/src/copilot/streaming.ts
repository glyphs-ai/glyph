import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SessionEvent } from "@github/copilot-sdk";
import type { ActivityItem, StreamActivityOpts } from "../types.js";
import { CopilotActivityStreamParser } from "./activity.js";
import type { EventBuffer } from "./launch-headless.js";

/**
 * Maximum bytes read from `events.jsonl` in one
 * {@link CopilotRuntime.readActivity} call. Sized to comfortably fit
 * a long autonomous run (hundreds of turns) without risking OOM. When
 * exceeded, the caller tail-reads the last N bytes and marks the
 * response truncated.
 */
export const COPILOT_RAW_READ_CAP_BYTES = 4 * 1024 * 1024;

/**
 * Poll interval for the disk-based live-tail stream. 250ms is the
 * upper bound on perceived dashboard latency for live-tail; faster
 * than this risks burning CPU on idle streams.
 */
export const COPILOT_TAIL_POLL_MS = 250;

/**
 * Serialize an {@link EventBuffer} back to the JSONL shape that the
 * activity parser expects. Lets the buffer-backed and disk-backed
 * `readActivity` paths share the exact same parser.
 *
 * One event per line, no trailing newline (parser tolerates either).
 */
export function serializeEventBuffer(buffer: EventBuffer): string {
  return buffer.events.map((event) => JSON.stringify(event)).join("\n");
}

/**
 * Live-tail from an in-memory {@link EventBuffer}. Seeds parser state
 * from already-buffered events so live `tool.execution_complete`
 * events can update earlier tool_call items and seqs continue after
 * multi-item source events. Does NOT replay history to the subscriber.
 */
export async function* streamFromBuffer(
  buffer: EventBuffer,
  opts: StreamActivityOpts,
): AsyncIterable<ActivityItem> {
  const parser = new CopilotActivityStreamParser();
  for (const event of buffer.events) {
    parser.parseLine(JSON.stringify(event));
  }

  // Queue + notify pattern: pending events are pushed into `queue`
  // by the SDK callback; the generator drains the queue on each
  // wakeup.
  const queue: SessionEvent[] = [];
  let wake: (() => void) | undefined;
  const subscriber = (event: SessionEvent) => {
    queue.push(event);
    wake?.();
  };
  buffer.subscribers.add(subscriber);
  try {
    while (true) {
      if (opts.signal?.aborted) return;
      while (queue.length > 0) {
        if (opts.signal?.aborted) return;
        const event = queue.shift() as SessionEvent;
        const result = parser.parseLine(JSON.stringify(event));
        for (const item of result.items) {
          yield item;
        }
      }
      if (buffer.finished) return;
      if (opts.signal?.aborted) return;
      await new Promise<void>((resolve) => {
        if (opts.signal?.aborted) {
          resolve();
          return;
        }
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          opts.signal?.removeEventListener("abort", settle);
          resolve();
        };
        wake = settle;
        opts.signal?.addEventListener("abort", settle, { once: true });
      });
      wake = undefined;
    }
  } finally {
    buffer.subscribers.delete(subscriber);
  }
}

/**
 * Count activity items in a Copilot NDJSON events file without fully
 * parsing each event. Uses newline counting as a fast path: each
 * non-empty line corresponds to one event.
 */
function countItemsFastPath(raw: string): number {
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10) count++;
  }
  // Account for a non-empty trailing line without a final newline.
  if (raw.length > 0 && raw.charCodeAt(raw.length - 1) !== 10) {
    const lastNewline = raw.lastIndexOf("\n");
    const lastLine = lastNewline === -1 ? raw : raw.slice(lastNewline + 1);
    if (lastLine.trim().length > 0) count++;
  }
  return count;
}

/**
 * Tail `events.jsonl` from disk for orphan-recovered sessions with
 * no in-memory buffer.
 *
 * @param copilotStateDir - Root directory containing per-session subdirs.
 * @param id - The validated copilot session id (subdir name).
 * @param opts - Streaming options (signal, after cursor).
 */
export async function* streamFromDisk(
  copilotStateDir: string,
  id: string,
  opts: StreamActivityOpts,
): AsyncIterable<ActivityItem> {
  const eventsPath = path.join(copilotStateDir, id, "events.jsonl");

  let offset: number;
  let parser: CopilotActivityStreamParser;
  try {
    const st = await stat(eventsPath);
    offset = st.size;
    let startSeq: number;
    if (typeof opts.after === "number") {
      startSeq = opts.after + 1;
    } else if (st.size === 0) {
      startSeq = 0;
    } else {
      startSeq = countItemsFastPath(await readFile(eventsPath, "utf8"));
    }
    parser = new CopilotActivityStreamParser(startSeq);
  } catch {
    offset = 0;
    parser = new CopilotActivityStreamParser(typeof opts.after === "number" ? opts.after + 1 : 0);
  }

  let buffer = "";

  while (true) {
    if (opts.signal?.aborted) return;

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(eventsPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return;
      }
      throw err;
    }

    if (st.size > offset) {
      const fh = await open(eventsPath, "r");
      try {
        const len = st.size - offset;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, offset);
        buffer += buf.toString("utf8");
        offset = st.size;
      } finally {
        await fh.close();
      }

      while (true) {
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx === -1) break;
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const result = parser.parseLine(line);
        for (const item of result.items) {
          if (opts.signal?.aborted) return;
          yield item;
        }
      }
    } else if (st.size < offset) {
      return;
    }

    try {
      await delay(COPILOT_TAIL_POLL_MS, undefined, { signal: opts.signal });
    } catch {
      return;
    }
  }
}
