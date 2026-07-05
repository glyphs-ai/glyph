import { Writable } from "node:stream";
import pino, { type Level, type Logger } from "pino";

/**
 * Test-only logging capture. Internal to `packages/api/test/`; sibling test
 * files import via relative paths (`../_capture-logger.js`). Not re-exported.
 * Mirrors the server package's equivalent helper so route tests that assert on
 * `logFault` observability output can run against the api-owned route factories.
 */

/**
 * One captured log entry. Field shape matches pino's JSON output:
 *   { level: 30, time: 1715000000000, msg: "...", ...meta }
 * Tests filter by numeric `level` and assert on `msg` + the meta they care about.
 */
export interface CapturedLogEntry {
  level: number;
  time?: number;
  msg?: string;
  [key: string]: unknown;
}

/** Numeric → string mapping for pino levels, useful in test assertions. */
export const PINO_LEVEL: Readonly<Record<number, Level>> = Object.freeze({
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
});

/**
 * Build a `Logger` plus a backing `entries` array that captures every log line
 * as a parsed JSON object. `level` defaults to `"trace"` so every call site is
 * captured; pass a higher level to assert that lower lines are filtered.
 */
export function captureLogger(opts: { level?: Level } = {}): {
  readonly logger: Logger;
  readonly entries: CapturedLogEntry[];
} {
  const entries: CapturedLogEntry[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        try {
          entries.push(JSON.parse(line) as CapturedLogEntry);
        } catch {
          // Non-JSON output (shouldn't happen with the default formatter) is
          // dropped; tests assert on parsed entries only.
        }
      }
      cb();
    },
  });
  const logger = pino(
    {
      level: opts.level ?? "trace",
      serializers: { err: pino.stdSerializers.err },
    },
    stream,
  );
  return { logger, entries };
}
