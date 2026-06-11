/**
 * Tests for the workspace warming-up surface in the low-level fetch
 * helpers.
 *
 * Backend protocol:
 *   - 202 + `{state: "warming", workspaceId}` means the per-workspace
 *     context isn't ready yet; the dashboard should NOT parse the
 *     body as a typed payload.
 *
 * What we pin:
 *   - `fetchJson` / `mutate` / `mutateJson` / `fetchJsonWithErrorBody`
 *     all reject a 202 with an `ApiError` whose `code` is
 *     `"WorkspaceWarming"` (so UI surfaces can branch without
 *     string-matching the message).
 *   - The thrown ApiError carries `status: 202` for transport-level
 *     retry policy (Retry-After).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchJson,
  fetchJsonWithErrorBody,
  mutate,
  mutateJson,
} from "../../src/api/http";

function install202(): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ state: "warming", workspaceId: "ws-cold" }), {
        status: 202,
        headers: { "content-type": "application/json", "Retry-After": "2" },
      }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("warming-up surface in fetch helpers", () => {
  it("fetchJson throws an ApiError tagged WorkspaceWarming on 202", async () => {
    install202();
    await expect(fetchJson("/api/workspaces/ws-cold/sessions", "sessions")).rejects.toMatchObject({
      name: "ApiError",
      status: 202,
      code: "WorkspaceWarming",
    });
  });

  it("mutate throws an ApiError tagged WorkspaceWarming on 202", async () => {
    install202();
    const err = await mutate("/api/workspaces/ws-cold/sessions", { method: "POST" }).catch(
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(202);
    expect((err as ApiError).code).toBe("WorkspaceWarming");
  });

  it("mutateJson throws an ApiError tagged WorkspaceWarming on 202", async () => {
    install202();
    const err = await mutateJson("/api/workspaces/ws-cold/sessions", { method: "POST" }).catch(
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(202);
    expect((err as ApiError).code).toBe("WorkspaceWarming");
  });

  it("fetchJsonWithErrorBody throws an ApiError tagged WorkspaceWarming on 202", async () => {
    install202();
    const err = await fetchJsonWithErrorBody("/api/workspaces/ws-cold/schedules").catch(
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(202);
    expect((err as ApiError).code).toBe("WorkspaceWarming");
    // The message names the workspace so toast UI can render it without
    // re-fetching the body.
    expect((err as ApiError).message).toContain("ws-cold");
  });
});
