/**
 * Unit proof for the RFC 9457 Problem assembler (`schemas/problem.ts`).
 *
 * Pins the pure wire-shape helpers — `kebabCase` / `problemTypeUri`
 * `type`-URI derivation, `toProblem` core-field + extension projection
 * (including the "drop `undefined`" rule), `validationProblem`, and the
 * `ProblemSchema` catchall — so the envelope contract can't drift
 * independently of the error seam that emits it.
 */

import { describe, expect, it } from "vitest";
import {
  kebabCase,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_JSON_SCHEMA,
  PROBLEM_TYPE_PREFIX,
  ProblemSchema,
  problemTypeUri,
  toProblem,
  validationProblem,
} from "../../src/schemas/problem.js";

describe("kebabCase", () => {
  it.each([
    ["AgentNotFound", "agent-not-found"],
    ["WorkflowSubgraphInvalid", "workflow-subgraph-invalid"],
    ["ValidationError", "validation-error"],
    ["BadRequest", "bad-request"],
    ["NotFound", "not-found"],
    ["InternalError", "internal-error"],
    // Acronym run: the second regex splits `MCP` from the trailing word.
    ["MCPNotFound", "mcp-not-found"],
  ])("%s → %s", (code, slug) => {
    expect(kebabCase(code)).toBe(slug);
  });
});

describe("problemTypeUri", () => {
  it("prefixes the kebab-cased code with the stable type prefix", () => {
    expect(problemTypeUri("EntryNotReady")).toBe(`${PROBLEM_TYPE_PREFIX}entry-not-ready`);
  });
});

describe("toProblem", () => {
  it("assembles the RFC 9457 core fields and derives `type` from `code`", () => {
    const p = toProblem({
      status: 404,
      title: "Session not found",
      detail: "session not found",
      code: "SessionNotFound",
    });
    expect(p).toEqual({
      type: "https://errors.glyph.ai/session-not-found",
      title: "Session not found",
      status: 404,
      detail: "session not found",
      code: "SessionNotFound",
    });
  });

  it("includes `instance` only when supplied", () => {
    expect(toProblem({ status: 400, title: "t", detail: "d", code: "C" })).not.toHaveProperty(
      "instance",
    );
    expect(
      toProblem({ status: 400, title: "t", detail: "d", code: "C", instance: "/api/x" }).instance,
    ).toBe("/api/x");
  });

  it("spreads defined extension members and drops `undefined` ones", () => {
    const p = toProblem({
      status: 409,
      title: "Invalid transition",
      detail: "illegal task state transition",
      code: "InvalidTransition",
      extensions: {
        fromStatus: "success",
        transition: "cancel",
        agent: undefined,
        reason: { kind: "disabledByUser" },
      },
    });
    expect(p).toEqual({
      type: "https://errors.glyph.ai/invalid-transition",
      title: "Invalid transition",
      status: 409,
      detail: "illegal task state transition",
      code: "InvalidTransition",
      fromStatus: "success",
      transition: "cancel",
      reason: { kind: "disabledByUser" },
    });
    expect(p).not.toHaveProperty("agent");
  });

  it("carries arbitrary extension members through the schema catchall", () => {
    const p = toProblem({
      status: 409,
      title: "Delete blocked",
      detail: "workflow has in-flight tasks",
      code: "WorkflowDeleteHasInFlightTasks",
      extensions: { transition: "delete", holdoutNodeIds: ["n1", "n2"] },
    });
    const parsed = ProblemSchema.parse(p);
    expect(parsed.holdoutNodeIds).toEqual(["n1", "n2"]);
    expect(parsed.transition).toBe("delete");
  });
});

describe("validationProblem", () => {
  it("emits the shared 400 ValidationError envelope with issues", () => {
    const p = validationProblem([{ path: "name", message: "Expected string" }]);
    expect(p).toEqual({
      type: "https://errors.glyph.ai/validation-error",
      title: "Validation error",
      status: 400,
      detail: "request validation failed",
      code: "ValidationError",
      issues: [{ path: "name", message: "Expected string" }],
    });
  });
});

describe("ProblemSchema", () => {
  it("accepts a fully-populated problem and rejects one missing a core field", () => {
    expect(() =>
      ProblemSchema.parse({
        type: "https://errors.glyph.ai/bad-request",
        title: "Bad request",
        status: 400,
        detail: "bad",
        code: "BadRequest",
      }),
    ).not.toThrow();
    // `detail` is required by RFC 9457's glyph profile.
    expect(() =>
      ProblemSchema.parse({
        type: "https://errors.glyph.ai/bad-request",
        title: "Bad request",
        status: 400,
        code: "BadRequest",
      }),
    ).toThrow();
  });
});

describe("wire constants", () => {
  it("pins the media type and the JSON-schema required core", () => {
    expect(PROBLEM_CONTENT_TYPE).toBe("application/problem+json");
    expect(PROBLEM_JSON_SCHEMA.required).toEqual(["type", "title", "status", "detail", "code"]);
    expect(PROBLEM_JSON_SCHEMA.additionalProperties).toBe(true);
  });
});
