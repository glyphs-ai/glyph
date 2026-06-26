import { describe, expect, it } from "vitest";
import { GlyphError, isGlyphError } from "../src/index.js";

describe("GlyphError", () => {
  const response = new Response(null, { status: 418 });

  it("captures the full envelope on construction", () => {
    const err = new GlyphError({
      status: 418,
      code: "Teapot",
      message: "short and stout",
      issues: [{ path: "body", message: "nope" }],
      response,
    });
    expect(err.status).toBe(418);
    expect(err.code).toBe("Teapot");
    expect(err.message).toBe("short and stout");
    expect(err.issues).toEqual([{ path: "body", message: "nope" }]);
    expect(err.response).toBe(response);
    expect(err.name).toBe("GlyphError");
  });

  it("leaves optional fields undefined when omitted", () => {
    const err = new GlyphError({ status: 500, message: "boom", response });
    expect(err.code).toBeUndefined();
    expect(err.issues).toBeUndefined();
  });

  it("is a real Error subclass", () => {
    const err = new GlyphError({ status: 400, message: "x", response });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GlyphError);
  });

  it("trims its own constructor frame from the V8 stack", () => {
    function makeError(): GlyphError {
      return new GlyphError({ status: 500, message: "boom", response });
    }
    const err = makeError();
    const frames = (err.stack ?? "").split("\n").filter((line) => line.trim().startsWith("at "));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toContain("makeError");
    expect(frames[0]).not.toContain("GlyphError");
  });

  it("isGlyphError discriminates GlyphError from other values", () => {
    expect(isGlyphError(new GlyphError({ status: 400, message: "x", response }))).toBe(true);
    expect(isGlyphError(new Error("plain"))).toBe(false);
    expect(isGlyphError({ status: 400, message: "x" })).toBe(false);
    expect(isGlyphError(null)).toBe(false);
    expect(isGlyphError(undefined)).toBe(false);
  });
});
