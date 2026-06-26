import { describe, expect, it } from "vitest";
import { type GlyphError, isGlyphError, unwrap, unwrapOr } from "../src/index.js";

function response(status: number, statusText?: string): Response {
  return new Response(null, statusText === undefined ? { status } : { status, statusText });
}

describe("unwrap", () => {
  it("returns the payload on a 2xx result", () => {
    const data = { items: [1, 2, 3] };
    expect(unwrap({ data, response: response(200) })).toBe(data);
  });

  interface ErrorCase {
    readonly name: string;
    readonly error: unknown;
    readonly response: Response;
    readonly status: number;
    readonly message: string;
    readonly code: string | undefined;
    readonly issues: ReadonlyArray<{ path: string; message: string }> | undefined;
  }

  const errorCases: readonly ErrorCase[] = [
    {
      name: "400 ValidationError envelope",
      error: {
        error: "request validation failed",
        code: "ValidationError",
        issues: [{ path: "body.name", message: "Required" }],
      },
      response: response(400),
      status: 400,
      message: "request validation failed",
      code: "ValidationError",
      issues: [{ path: "body.name", message: "Required" }],
    },
    {
      name: "500 { error } business envelope",
      error: { error: "internal boom" },
      response: response(500),
      status: 500,
      message: "internal boom",
      code: undefined,
      issues: undefined,
    },
    {
      name: "502 non-JSON body falls back to status text",
      error: "<html>502 Bad Gateway</html>",
      response: response(502, "Bad Gateway"),
      status: 502,
      message: "Bad Gateway",
      code: undefined,
      issues: undefined,
    },
  ];

  for (const tc of errorCases) {
    it(`throws a GlyphError for the ${tc.name}`, () => {
      let thrown: unknown;
      try {
        unwrap({ error: tc.error, response: tc.response });
        expect.unreachable("unwrap should have thrown");
      } catch (err) {
        thrown = err;
      }
      expect(isGlyphError(thrown)).toBe(true);
      const ge = thrown as GlyphError;
      expect(ge.status).toBe(tc.status);
      expect(ge.message).toBe(tc.message);
      expect(ge.code).toBe(tc.code);
      expect(ge.issues).toEqual(tc.issues);
      expect(ge.response).toBe(tc.response);
    });
  }

  it("re-throws a transport-level Error untouched", () => {
    const boom = new Error("network down");
    // A transport failure resolves with no `response`, so omit it here.
    expect(() => unwrap({ error: boom })).toThrow(boom);
  });
});

describe("unwrapOr", () => {
  it("returns the payload on success", () => {
    const data = { ok: true };
    expect(unwrapOr({ data, response: response(200) }, "fallback")).toBe(data);
  });

  it("returns the fallback on failure", () => {
    const result = { error: { error: "nope" }, response: response(500) };
    expect(unwrapOr(result, "fallback")).toBe("fallback");
  });
});
