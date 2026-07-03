/**
 * Runtime request-validation proof.
 *
 * The `POST /api/workspaces` route attaches a zod request-body
 * validator (`CreateWorkspaceRequestSchema`) via `createRoute`. A body
 * that fails the schema is rejected by `@hono/zod-openapi`'s
 * `defaultHook` (installed in `routes/_openapi.ts`) BEFORE the handler
 * runs, and is surfaced as a structured 400 envelope
 * (`{ error, code: "ValidationError", issues }`). This pins that
 * behaviour so the zod-derived 400 contract can't silently regress.
 */

import { describe, expect, it } from "vitest";
import type { Application } from "../../src/application.js";
import { workspacesRoutes } from "../../src/routes/workspaces.js";

/**
 * Construction-time stub: `workspacesRoutes` destructures
 * `application.workspaceService`, so a nested Proxy satisfies the
 * destructure. The handler is never reached (validation fails first),
 * so any accidental method call throws loudly.
 */
function stubApplication(): Application {
  const propStub = new Proxy(
    {},
    {
      get() {
        throw new Error("stubApplication: not callable");
      },
    },
  );
  return new Proxy({} as Application, {
    get() {
      return propStub;
    },
  });
}

describe("request validation — zod 400 envelope", () => {
  it("rejects a malformed POST /api/workspaces body before the handler runs", async () => {
    const app = workspacesRoutes(stubApplication());

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `name` must be a string per CreateWorkspaceRequestSchema.
      body: JSON.stringify({ name: 123 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      code: string;
      issues: { path: string; message: string }[];
    };
    expect(body.code).toBe("ValidationError");
    expect(body.error).toBe("request validation failed");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues.some((issue) => issue.path === "name")).toBe(true);
  });
});
