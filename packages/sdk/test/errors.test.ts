import { describe, expect, it } from "vitest";
import { GlyphError, isGlyphError, isProblem, type Problem, parseProblem } from "../src/index.js";

describe("GlyphError", () => {
  const response = new Response(null, { status: 418 });

  it("captures the full envelope on construction", () => {
    const body: Problem = {
      type: "https://errors.glyph.ai/teapot",
      title: "Teapot",
      status: 418,
      detail: "short and stout",
      code: "Teapot",
    };
    const err = new GlyphError({
      status: 418,
      code: "Teapot",
      message: "short and stout",
      issues: [{ path: "body", message: "nope" }],
      response,
      body,
    });
    expect(err.status).toBe(418);
    expect(err.code).toBe("Teapot");
    expect(err.message).toBe("short and stout");
    expect(err.issues).toEqual([{ path: "body", message: "nope" }]);
    expect(err.response).toBe(response);
    expect(err.body).toBe(body);
    expect(err.name).toBe("GlyphError");
  });

  it("leaves optional fields undefined when omitted", () => {
    const err = new GlyphError({ status: 500, message: "boom", response });
    expect(err.code).toBeUndefined();
    expect(err.issues).toBeUndefined();
    expect(err.body).toBeUndefined();
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

describe("isProblem", () => {
  it("accepts a body with all five required core members", () => {
    const problem: Problem = {
      type: "https://errors.glyph.ai/entry-not-ready",
      title: "Entry not ready",
      status: 409,
      detail: "agent is not ready",
      code: "EntryNotReady",
      agent: "official/coordinator",
    };
    expect(isProblem(problem)).toBe(true);
  });

  it("rejects bodies missing a required member or of the wrong type", () => {
    expect(isProblem({ type: "x", title: "y", status: 400, detail: "z" })).toBe(false);
    expect(isProblem({ type: "x", title: "y", status: "400", detail: "z", code: "C" })).toBe(false);
    expect(isProblem("<html>not json</html>")).toBe(false);
    expect(isProblem(null)).toBe(false);
    expect(isProblem(undefined)).toBe(false);
  });
});

describe("parseProblem", () => {
  function problemResponse(body: unknown, status = 400): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/problem+json" },
    });
  }

  it("decodes a well-formed application/problem+json body", async () => {
    const problem: Problem = {
      type: "https://errors.glyph.ai/workflow-not-found",
      title: "Workflow not found",
      status: 404,
      detail: "workflow not found: wf-1",
      code: "WorkflowNotFound",
    };
    expect(await parseProblem(problemResponse(problem, 404))).toEqual(problem);
  });

  it("tolerates a charset parameter on the content-type", async () => {
    const problem: Problem = {
      type: "https://errors.glyph.ai/validation-error",
      title: "Validation error",
      status: 400,
      detail: "bad input",
      code: "ValidationError",
    };
    const res = new Response(JSON.stringify(problem), {
      status: 400,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    });
    expect(await parseProblem(res)).toEqual(problem);
  });

  it("returns undefined — without reading the body — for a non-Problem content-type", async () => {
    // A 202 warming envelope rides in application/json, not problem+json;
    // parseProblem must leave its body unread so the caller can consume it.
    const res = new Response(JSON.stringify({ state: "warming", workspaceId: "ws-cold" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
    expect(await parseProblem(res)).toBeUndefined();
    expect(res.bodyUsed).toBe(false);
    expect(await res.json()).toEqual({ state: "warming", workspaceId: "ws-cold" });
  });

  it("returns undefined for a problem+json body that fails validation", async () => {
    expect(await parseProblem(problemResponse({ type: "x", title: "y" }))).toBeUndefined();
  });

  it("returns undefined for a malformed JSON body", async () => {
    const res = new Response("{ not json", {
      status: 500,
      headers: { "content-type": "application/problem+json" },
    });
    expect(await parseProblem(res)).toBeUndefined();
  });
});
