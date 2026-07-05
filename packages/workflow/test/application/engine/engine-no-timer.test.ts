/**
 * Tripwire test for the workflow engine source.
 *
 * The engine module MUST NOT contain `setInterval` or `setTimeout`.
 * All polling cadence lives inside concrete runner implementations
 * (e.g. `packages/api/src/wiring/workflow-worker-task-runner.ts`).
 *
 * This is a SOURCE-level grep — strings appearing inside JSDoc
 * comments (e.g. "MUST NOT contain `setInterval`") are intentionally
 * suffixed with backticks so they don't match the bare token; the
 * test only flags real call-sites by requiring an opening parenthesis
 * after the token.
 *
 * If you need a deferred callback in the engine, do not work around
 * this tripwire — fix the design seam first.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const enginePath = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "application",
  "engine",
  "workflow-engine.ts",
);

describe("@glyphs-ai/workflow engine tripwire", () => {
  it("workflow-engine.ts contains no setInterval or setTimeout call sites", () => {
    const src = readFileSync(enginePath, "utf8");
    // Match the function-call form: token immediately followed by an
    // opening paren. This deliberately allows JSDoc comments to
    // mention `setInterval` / `setTimeout` as long as the backtick-
    // wrapped reference doesn't get followed by `(`.
    const callRe = /\b(setInterval|setTimeout)\s*\(/g;
    const matches = src.match(callRe) ?? [];
    expect(matches, `Found timer call(s) in workflow-engine.ts: ${matches.join(", ")}`).toEqual([]);
  });
});
