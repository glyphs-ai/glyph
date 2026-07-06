/**
 * Tests for `formatError` — the CLI's error-formatting layer that
 * turns a thrown {@link ApiError} into a structured stderr message.
 *
 * These tests pin the error-formatting contract:
 *  - the server's optional `code` envelope field is surfaced (so
 *    `WorkspaceNotFoundError` looks different from `BadRequest`),
 *  - the `EntryNotReady` envelope extension fields (`agent`,
 *    `reason`) are unpacked into actionable hints pointing at the
 *    matching `glyph catalog ...` subcommand, mirroring the
 *    dashboard's typed-error UI.
 *
 * Network errors and plain `Error` instances are also covered to
 * pin their exit-code mapping.
 */

import type { Problem } from "@glyphs-ai/sdk";
import { describe, expect, it } from "vitest";
import { formatError } from "../src/output.js";
import { ApiError } from "../src/sdk-client.js";

/**
 * Build a valid RFC 9457 {@link Problem} body for an {@link ApiError}
 * fixture. Fills the required core members from `code` so each test only
 * spells out the extension members it exercises.
 */
function problem(fields: Partial<Problem> & { code: string }): Problem {
  return {
    type: `https://errors.glyph.ai/${fields.code}`,
    title: fields.code,
    status: 400,
    detail: "error",
    ...fields,
  };
}

describe("formatError", () => {
  it("ApiError without a Problem body renders as a single-line HTTP message", () => {
    const err = new ApiError(404, "not found");
    const r = formatError(err);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toBe("not found (HTTP 404)\n");
  });

  it("surfaces the `code` field from the error envelope", () => {
    const err = new ApiError(404, "not found", problem({ code: "WorkspaceNotFoundError" }));
    const r = formatError(err);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toBe("not found (HTTP 404, WorkspaceNotFoundError)\n");
  });

  it("EntryNotReady surfaces agent + disabledByUser CTA", () => {
    const err = new ApiError(
      409,
      'agent "writer" is not ready: disabled by user',
      problem({
        code: "EntryNotReady",
        status: 409,
        agent: "acme/writer",
        reason: { disabledByUser: true },
      }),
    );
    const r = formatError(err);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("EntryNotReady");
    expect(r.stderr).toContain("agent: acme/writer");
    expect(r.stderr).toContain("cause: agent is disabled");
    expect(r.stderr).toContain("glyph catalog agent enable acme/writer");
  });

  it("EntryNotReady surfaces the prereqs-ack CTA", () => {
    const err = new ApiError(
      409,
      "blocked",
      problem({
        code: "EntryNotReady",
        status: 409,
        agent: "acme/data-pipeline",
        reason: { needsPrereqsAck: true },
      }),
    );
    const r = formatError(err);
    expect(r.stderr).toContain("cause: prereqs not acknowledged");
    expect(r.stderr).toContain("glyph catalog agent ack-prereqs acme/data-pipeline");
  });

  it("EntryNotReady lists missingDeps and suggests installation", () => {
    const err = new ApiError(
      409,
      "blocked",
      problem({
        code: "EntryNotReady",
        status: 409,
        agent: "acme/foo",
        reason: {
          missingDeps: [
            { kind: "skill", fqn: "acme/git-pr" },
            { kind: "mcp", fqn: "github/mcp" },
          ],
        },
      }),
    );
    const r = formatError(err);
    expect(r.stderr).toContain("cause: missing dependencies (2)");
    expect(r.stderr).toContain("- skill: acme/git-pr");
    expect(r.stderr).toContain("- mcp: github/mcp");
    expect(r.stderr).toContain("install the missing dependencies");
  });

  it("EntryNotReady lists blockedDeps", () => {
    const err = new ApiError(
      409,
      "blocked",
      problem({
        code: "EntryNotReady",
        status: 409,
        agent: "acme/foo",
        reason: { blockedDeps: [{ kind: "agent", fqn: "acme/bar" }] },
      }),
    );
    const r = formatError(err);
    expect(r.stderr).toContain("cause: blocked dependencies (1)");
    expect(r.stderr).toContain("- agent: acme/bar");
    expect(r.stderr).toContain("resolve the blocked dependencies");
  });

  it("EntryNotReady handles missing reason gracefully", () => {
    // No `reason` field at all → only the agent line is emitted.
    // The "unknown variant" fallback must NOT fire here because the
    // server didn't send a reason payload at all (this happens when
    // the manager threw EntryNotReady without a structured
    // BlockedReason — the route surface still includes agent + code).
    const err = new ApiError(
      409,
      "blocked",
      problem({ code: "EntryNotReady", status: 409, agent: "acme/foo" }),
    );
    const r = formatError(err);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("agent: acme/foo");
    expect(r.stderr).not.toContain("not recognized by this CLI version");
  });

  it("EntryNotReady surfaces a generic CTA when reason has no recognized field", () => {
    // If the server sends a BlockedReason variant this CLI does not
    // recognize, still emit an actionable line rather than only the
    // agent name and HTTP code.
    const err = new ApiError(
      409,
      "blocked",
      problem({
        code: "EntryNotReady",
        status: 409,
        agent: "acme/foo",
        reason: { someFutureBlock: true },
      }),
    );
    const r = formatError(err);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("agent: acme/foo");
    expect(r.stderr).toContain("blocked (reason fields not recognized");
    expect(r.stderr).toContain("upgrade the CLI");
  });

  it("ECONNREFUSED-shaped TypeError maps to exit code 3", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), {
      code: "ECONNREFUSED",
    });
    const err = new TypeError("fetch failed");
    (err as Error & { cause?: unknown }).cause = cause;
    const r = formatError(err);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("server unreachable");
    expect(r.stderr).toContain("ECONNREFUSED");
  });

  it("generic Error falls through to exit code 1", () => {
    const r = formatError(new Error("kaboom"));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe("kaboom\n");
  });

  it("non-Error value coerces to string at exit code 1", () => {
    const r = formatError("string thrown" as unknown);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe("string thrown\n");
  });
});
