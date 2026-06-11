import { afterEach, beforeEach, vi } from "vitest";

/**
 * Default fetch stub installed before EVERY test. Any test that
 * expects to perform fetches must override this with its own
 * `vi.fn()` / `vi.spyOn`. The throw is synchronous so the failure
 * surfaces in the test's own assertion frame, not in a worker-
 * global unhandledrejection that intermittently crashes the
 * run on macOS and Windows CI legs.
 *
 * Paired with `happy-dom.url = http://test.invalid/` so any relative
 * URL fetch that *does* escape the stub fails on URL semantics rather
 * than the OS net stack (no DNS / TCP retries to ECONNREFUSED).
 */
const REAL_FETCH = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});
