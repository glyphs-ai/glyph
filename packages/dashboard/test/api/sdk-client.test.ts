/**
 * Tests for the dashboard's `@glyphs-ai/sdk` seam (`sdk-client.ts`).
 *
 * `unwrap` backs nearly every dashboard query/mutation, so its error
 * mapping is the primary user-visible error path. These pin the RFC 9457
 * contract the modal/inline surfaces depend on:
 *   - a Problem body's `detail` becomes `ApiError.message` (NOT the bare
 *     status — a regression here shows users a meaningless "404"/"409"),
 *   - `code` / `field` extensions ride along for typed UI branching,
 *   - the 202 warming envelope maps to `code: "WorkspaceWarming"`,
 *   - a transport failure (no `response`) rethrows untouched.
 *
 * The result tuples are built by hand (no MSW) so the assertions exercise
 * `unwrap` → `buildApiError` directly, which the higher-level modal tests
 * bypass by injecting pre-built `ApiError`s.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/api/http";
import { unwrap } from "../../src/api/sdk-client";

function res(status: number): Response {
  return new Response(null, { status });
}

describe("sdk-client unwrap — error envelope mapping", () => {
  it("maps a Problem body's `detail` onto ApiError.message", () => {
    // hey-api decodes the application/problem+json body into `error`.
    const problem = {
      type: "https://errors.glyph.ai/workflow-not-found",
      title: "Workflow not found",
      status: 404,
      detail: "workflow not found",
      code: "WorkflowNotFound",
    };
    try {
      unwrap({ error: problem, response: res(404) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).code).toBe("WorkflowNotFound");
      // The regression guard: message is the server detail, not "404".
      expect((err as ApiError).message).toBe("workflow not found");
    }
  });

  it("carries the Problem `field` extension for inline validation surfaces", () => {
    const problem = {
      type: "https://errors.glyph.ai/workflow-coord-agent-not-capable-error",
      title: "Coordinator agent not capable",
      status: 422,
      detail: "official/writer cannot coordinate",
      code: "WorkflowCoordAgentNotCapableError",
      field: "coordinatorAgent",
    };
    try {
      unwrap({ error: problem, response: res(422) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect((err as ApiError).field).toBe("coordinatorAgent");
      expect((err as ApiError).message).toBe("official/writer cannot coordinate");
    }
  });

  it("falls back to the bare status for a non-Problem error body", () => {
    try {
      unwrap({ error: "<html>502 Bad Gateway</html>", response: res(502) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(502);
      expect((err as ApiError).message).toBe("502");
      expect((err as ApiError).code).toBeUndefined();
    }
  });

  it("maps a 202 warming envelope to code WorkspaceWarming", () => {
    // 202 is response.ok; the warming envelope rides in `data`.
    try {
      unwrap({ data: { state: "warming", workspaceId: "ws-cold" }, response: res(202) });
      expect.fail("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(202);
      expect((err as ApiError).code).toBe("WorkspaceWarming");
      expect((err as ApiError).message).toContain("ws-cold");
    }
  });

  it("rethrows the original transport error when there is no response", () => {
    const boom = new Error("network down");
    expect(() => unwrap({ error: boom })).toThrow(boom);
  });
});
