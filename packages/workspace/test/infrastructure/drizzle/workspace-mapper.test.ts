import { describe, expect, it } from "vitest";
import { WorkspaceEntity } from "../../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../../src/domain/workspace-name.js";
import {
  WorkspaceMapper,
  type WorkspaceRow,
} from "../../../src/infrastructure/drizzle/workspace-mapper.js";

const ROW_LOPENED: WorkspaceRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo",
  workspaceDir: "/x",
  createdAt: "2025-01-01T00:00:00.000Z",
  lastOpenedAt: "2025-06-01T00:00:00.000Z",
};

const ROW_NULL_LOPENED: WorkspaceRow = { ...ROW_LOPENED, lastOpenedAt: null };

describe("WorkspaceMapper.toDomain", () => {
  it("returns a WorkspaceEntity carrying every column value", () => {
    const e = WorkspaceMapper.toDomain(ROW_LOPENED);
    expect(e).toBeInstanceOf(WorkspaceEntity);
    expect(e.id).toBe(ROW_LOPENED.id);
    expect(e.name).toBe(ROW_LOPENED.name);
    expect(e.workspaceDir).toBe(ROW_LOPENED.workspaceDir);
    expect(e.createdAt).toBe(ROW_LOPENED.createdAt);
    expect(e.lastOpenedAt).toBe(ROW_LOPENED.lastOpenedAt);
  });

  it("preserves a null lastOpenedAt on rehydration", () => {
    const e = WorkspaceMapper.toDomain(ROW_NULL_LOPENED);
    expect(e.lastOpenedAt).toBeNull();
  });
});

describe("WorkspaceMapper.toRow", () => {
  it("extracts every column from an entity (round-trips with toDomain)", () => {
    const e = WorkspaceEntity.rehydrate({
      id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });
    expect(WorkspaceMapper.toRow(e)).toEqual(ROW_LOPENED);
  });

  it("writes null lastOpenedAt when the entity carries null", () => {
    const e = WorkspaceEntity.rehydrate({
      id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      name: "Demo" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    });
    expect(WorkspaceMapper.toRow(e).lastOpenedAt).toBeNull();
  });

  it("reflects post-mutation state", () => {
    const e = WorkspaceEntity.rehydrate({
      id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
      name: "Old" as WorkspaceName,
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    });
    e.rename("New" as WorkspaceName);
    e.markOpened(new Date("2099-12-31T23:59:59.000Z"));
    const row = WorkspaceMapper.toRow(e);
    expect(row.name).toBe("New");
    expect(row.lastOpenedAt).toBe("2099-12-31T23:59:59.000Z");
  });
});
