/**
 * Unit tests for the CLI's `@glyphs-ai/sdk` seam (`sdk-client.ts`).
 *
 * Two concerns, mock-fetch based, no real server:
 *
 *  - {@link unwrap} — the result-tuple → success-payload / throw mapping
 *    the CLI's exit-code policy depends on. The mapping: 2xx → data, 204 →
 *    `{}`, non-2xx → {@link ApiError} (message = `body.detail` when the
 *    error body is an RFC 9457 Problem, else `HTTP <status>`; `body` is the
 *    typed Problem or `undefined`), and a missing `response` (transport
 *    failure) → rethrow the original error untouched.
 *  - {@link configureClient} — request serialization pinned byte-for-byte
 *    to the former hand-rolled client: blanket `Accept: application/json`,
 *    `Content-Type` only on body-bearing requests, `URLSearchParams` query
 *    encoding (space → `+`, comma → `%2C`, `undefined` skipped), and the
 *    trailing-slash strip on the base URL.
 */

import { client } from "@glyphs-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureClient, unwrap } from "../src/sdk-client.js";

function res(status: number): Response {
  return new Response(null, { status });
}

describe("unwrap", () => {
  it("returns the parsed data on a 2xx", () => {
    const out = unwrap({ data: { id: "w1" }, response: res(200) });
    expect(out).toEqual({ id: "w1" });
  });

  it("returns the synthesized `{}` on a 204", () => {
    // The SDK fills `data = {}` for an empty 204; unwrap passes it through
    // so void deletes/cancels resolve instead of throwing.
    expect(unwrap({ data: {}, response: res(204) })).toEqual({});
  });

  it("throws ApiError with the body's `detail` string as the message", () => {
    const problem = {
      type: "https://errors.glyph.ai/validation-error",
      title: "Validation error",
      status: 400,
      detail: "name is required (string)",
      code: "ValidationError",
    };
    try {
      unwrap({ error: problem, response: res(400) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe("name is required (string)");
      expect((err as ApiError).body).toEqual(problem);
    }
  });

  it("falls back to `HTTP <status>` and drops a non-Problem error body", () => {
    // A body that isn't a well-formed RFC 9457 Problem (here a bare
    // string) must not be surfaced as a typed `body`; the message falls
    // back to the status line.
    try {
      unwrap({ error: "oops", response: res(500) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).message).toBe("HTTP 500");
      expect((err as ApiError).body).toBeUndefined();
    }
  });

  it("rethrows the original transport error when there is no response", () => {
    // No `response` => fetch itself threw (ECONNREFUSED / DNS / abort).
    // formatError maps this to exit code 3; the identity must survive.
    const boom = new Error("ECONNREFUSED");
    expect(() => unwrap({ error: boom })).toThrow(boom);
  });
});

interface CallRecord {
  url: string;
  method: string;
  accept: string | null;
  contentType: string | null;
  body: string;
}

function stubFetch(): { calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const req = input instanceof Request ? input : new Request(String(input));
    calls.push({
      url: req.url,
      method: req.method,
      accept: req.headers.get("accept"),
      contentType: req.headers.get("content-type"),
      body: await req.text(),
    });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configureClient serialization", () => {
  it("a body-less GET sends Accept only (no Content-Type, no body)", async () => {
    const { calls } = stubFetch();
    configureClient("http://test.local");
    await client.get({ url: "/api/health" });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("http://test.local/api/health");
    expect(calls[0]?.accept).toBe("application/json");
    expect(calls[0]?.contentType).toBeNull();
    expect(calls[0]?.body).toBe("");
  });

  it("a POST with a body sends both Accept and Content-Type plus JSON", async () => {
    const { calls } = stubFetch();
    configureClient("http://test.local");
    await client.post({ url: "/api/workspaces", body: { name: "Sandbox" } });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.accept).toBe("application/json");
    expect(calls[0]?.contentType).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "Sandbox" });
  });

  it("substitutes path params and encodes the query the URLSearchParams way", async () => {
    const { calls } = stubFetch();
    configureClient("http://test.local");
    await client.get({
      url: "/api/workspaces/{id}/tasks",
      path: { id: "ws-1" },
      query: { agent: "writer x", status: "running,success", runtime: undefined },
    });
    // space → `+`, comma → `%2C`, `undefined` dropped; insertion order kept.
    expect(calls[0]?.url).toBe(
      "http://test.local/api/workspaces/ws-1/tasks?agent=writer+x&status=running%2Csuccess",
    );
  });

  it("strips trailing slashes from the base URL", async () => {
    const { calls } = stubFetch();
    configureClient("http://test.local///");
    await client.get({ url: "/api/health" });
    expect(calls[0]?.url).toBe("http://test.local/api/health");
  });
});
