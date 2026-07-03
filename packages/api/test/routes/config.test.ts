import { describe, expect, it } from "vitest";
import type { ServerConfig } from "../../src/routes/config.js";
import { configRoutes } from "../../src/routes/config.js";

describe("configRoutes", () => {
  it("GET / returns the resolved server config with default tasks tunables", async () => {
    const res = await configRoutes({
      glyphHome: "/home/user/.glyph",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      currentWorkspaceId: () => "default",
    }).request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServerConfig;
    expect(body).toEqual({
      glyphHome: "/home/user/.glyph",
      currentWorkspaceId: "default",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      tasks: { pollIntervalMs: 4000 },
    });
  });

  it("honours an explicit taskPollIntervalMs override", async () => {
    const res = await configRoutes({
      glyphHome: "/h",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      currentWorkspaceId: () => null,
      taskPollIntervalMs: 1500,
    }).request("/");
    const body = (await res.json()) as ServerConfig;
    expect(body.tasks.pollIntervalMs).toBe(1500);
  });

  it("does not expose a global catalogDir field (catalog is per-workspace)", async () => {
    const res = await configRoutes({
      glyphHome: "/h",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      currentWorkspaceId: () => null,
    }).request("/");
    const body = (await res.json()) as ServerConfig & { catalogDir?: unknown };
    expect(body.catalogDir).toBeUndefined();
  });

  it("preserves Windows-style separator and path", async () => {
    const res = await configRoutes({
      glyphHome: "C:\\Users\\Lang\\.glyph",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "\\",
      currentWorkspaceId: () => null,
    }).request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServerConfig;
    expect(body.pathSeparator).toBe("\\");
    expect(body.glyphHome).toBe("C:\\Users\\Lang\\.glyph");
    expect(body.currentWorkspaceId).toBeNull();
  });

  it("evaluates currentWorkspaceId per request (registry can change)", async () => {
    let current: string | null = "alpha";
    const app = configRoutes({
      glyphHome: "/h",
      host: "127.0.0.1",
      port: 8787,
      pathSeparator: "/",
      currentWorkspaceId: () => current,
    });
    let body = (await (await app.request("/")).json()) as ServerConfig;
    expect(body.currentWorkspaceId).toBe("alpha");
    current = "beta";
    body = (await (await app.request("/")).json()) as ServerConfig;
    expect(body.currentWorkspaceId).toBe("beta");
  });
});
