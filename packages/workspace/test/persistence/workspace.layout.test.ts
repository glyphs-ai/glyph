import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkspaceLayout } from "../../src/persistence/workspace.layout.js";

describe("buildWorkspaceLayout", () => {
  it("returns sessions/tasks/workflows paths under the resolved root", () => {
    const root =
      process.platform === "win32" ? "C:\\workspaces\\my-project" : "/workspaces/my-project";
    const layout = buildWorkspaceLayout(root);
    const resolved = path.resolve(root);

    expect(layout.sessions).toBe(path.join(resolved, "sessions"));
    expect(layout.tasks).toBe(path.join(resolved, "tasks"));
    expect(layout.workflows).toBe(path.join(resolved, "workflows"));
  });

  it("resolves a trailing-slash root the same as without", () => {
    const root = process.platform === "win32" ? "C:\\workspaces\\p\\" : "/workspaces/p/";
    const layout = buildWorkspaceLayout(root);
    const resolved = path.resolve(root);

    expect(layout.sessions).toBe(path.join(resolved, "sessions"));
    expect(layout.tasks).toBe(path.join(resolved, "tasks"));
    expect(layout.workflows).toBe(path.join(resolved, "workflows"));
  });
});
