import { describe, expect, it } from "vitest";
import { WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";

const ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const NOW = "2025-01-01T00:00:00.000Z";

describe("WorkspaceEntity.create", () => {
  it("seeds lastOpenedAt to `now` so fresh registers sort at the top", () => {
    const e = WorkspaceEntity.create({
      id: ID,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      now: NOW,
    });
    expect(e.id).toBe(ID);
    expect(e.name).toBe("Demo");
    expect(e.workspaceDir).toBe("/x");
    expect(e.createdAt).toBe(NOW);
    expect(e.lastOpenedAt).toBe(NOW);
  });
});

describe("WorkspaceEntity.rehydrate", () => {
  it("accepts persisted state verbatim — lastOpenedAt may be null", () => {
    const e = WorkspaceEntity.rehydrate({
      id: ID,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: NOW,
      lastOpenedAt: null,
    });
    expect(e.lastOpenedAt).toBeNull();
  });
});

describe("WorkspaceEntity.rename", () => {
  it("updates the display name", () => {
    const e = WorkspaceEntity.create({
      id: ID,
      name: "Old" as WorkspaceName,
      workspaceDir: "/x",
      now: NOW,
    });
    e.rename("New" as WorkspaceName);
    expect(e.name).toBe("New");
  });

  it("is a no-op when the new name equals the current one", () => {
    const e = WorkspaceEntity.create({
      id: ID,
      name: "Same" as WorkspaceName,
      workspaceDir: "/x",
      now: NOW,
    });
    e.rename("Same" as WorkspaceName);
    expect(e.name).toBe("Same");
  });
});

describe("WorkspaceEntity.markOpened", () => {
  it("stores the timestamp as ISO-8601", () => {
    const e = WorkspaceEntity.rehydrate({
      id: ID,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: NOW,
      lastOpenedAt: null,
    });
    e.markOpened(new Date("2099-12-31T23:59:59.000Z"));
    expect(e.lastOpenedAt).toBe("2099-12-31T23:59:59.000Z");
  });

  it("overwrites a prior non-null lastOpenedAt", () => {
    const e = WorkspaceEntity.create({
      id: ID,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      now: "2025-01-01T00:00:00.000Z",
    });
    e.markOpened(new Date("2026-06-01T12:00:00.000Z"));
    expect(e.lastOpenedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});
