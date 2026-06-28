import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceEntity } from "../../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../../src/domain/workspace-name.js";
import { openDb } from "../../../src/infrastructure/drizzle/db.js";
import { DrizzleWorkspaceRepository } from "../../../src/infrastructure/drizzle/workspace-repository.js";

function setupRepo(): DrizzleWorkspaceRepository {
  const { db } = openDb(":memory:");
  return new DrizzleWorkspaceRepository({ db });
}

let repo: DrizzleWorkspaceRepository;

beforeEach(() => {
  repo = setupRepo();
});

// Trusted test fixtures: every value is hand-authored to satisfy the
// branded schemas (UUID format, non-empty name). Casting once here
// keeps assertions concise — going through `WorkspaceIdSchema.parse`
// for each constant would add noise without catching anything
// (developer error in fixture data fails the test anyway).
const STATE_A = {
  id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
  name: "Alpha" as WorkspaceName,
  workspaceDir: "/workspaces/alpha",
  createdAt: "2025-01-01T00:00:00.000Z",
  lastOpenedAt: "2025-01-02T00:00:00.000Z",
};

const STATE_B = {
  id: "22222222-2222-4222-8222-222222222222" as WorkspaceId,
  name: "Beta" as WorkspaceName,
  workspaceDir: "/workspaces/beta",
  createdAt: "2025-02-01T00:00:00.000Z",
  lastOpenedAt: "2025-02-03T00:00:00.000Z",
};

const STATE_C = {
  id: "33333333-3333-4333-8333-333333333333" as WorkspaceId,
  name: "Gamma" as WorkspaceName,
  workspaceDir: "/workspaces/gamma",
  createdAt: "2025-03-01T00:00:00.000Z",
  lastOpenedAt: "2025-01-15T00:00:00.000Z",
};

describe("DrizzleWorkspaceRepository", () => {
  describe("insert + findById round-trip", () => {
    it("inserts an entity and retrieves it by id", async () => {
      const insertRes = await repo.insert(new WorkspaceEntity(STATE_A));
      expect(insertRes.isOk()).toBe(true);
      const found = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      expect(found).toBeInstanceOf(WorkspaceEntity);
      expect(found?.id).toBe(STATE_A.id);
      expect(found?.name).toBe(STATE_A.name);
      expect(found?.workspaceDir).toBe(STATE_A.workspaceDir);
      expect(found?.createdAt).toBe(STATE_A.createdAt);
      expect(found?.lastOpenedAt).toBe(STATE_A.lastOpenedAt);
    });
  });

  describe("findByPath", () => {
    it("finds by workspaceDir", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      const found = (await repo.findByPath(STATE_A.workspaceDir))._unsafeUnwrap();
      expect(found?.id).toBe(STATE_A.id);
    });

    it("returns undefined for unknown path", async () => {
      const found = (await repo.findByPath("/unknown"))._unsafeUnwrap();
      expect(found).toBeUndefined();
    });
  });

  describe("findAllByLastOpened ordering", () => {
    it("returns workspaces ordered by lastOpenedAt DESC", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      await repo.insert(new WorkspaceEntity(STATE_B));
      await repo.insert(new WorkspaceEntity(STATE_C));

      const all = (await repo.findAllByLastOpened())._unsafeUnwrap();
      // B (2025-02-03) > C (2025-01-15) > A (2025-01-02)
      expect(all.map((r) => r.id)).toEqual([STATE_B.id, STATE_C.id, STATE_A.id]);
    });
  });

  describe("findLastOpened", () => {
    it("returns the most-recently-opened workspace", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      await repo.insert(new WorkspaceEntity(STATE_B));
      const last = (await repo.findLastOpened())._unsafeUnwrap();
      expect(last?.id).toBe(STATE_B.id);
    });

    it("returns undefined on empty table", async () => {
      const last = (await repo.findLastOpened())._unsafeUnwrap();
      expect(last).toBeUndefined();
    });
  });

  describe("findLastOpenedId", () => {
    it("returns the id of the most-recently-opened workspace", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      await repo.insert(new WorkspaceEntity(STATE_B));
      const id = (await repo.findLastOpenedId())._unsafeUnwrap();
      expect(id).toBe(STATE_B.id);
    });

    it("returns undefined on empty table", async () => {
      const id = (await repo.findLastOpenedId())._unsafeUnwrap();
      expect(id).toBeUndefined();
    });
  });

  describe("save (whole-entity write of mutated aggregate)", () => {
    it("persists rename — re-read shows the new name", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      const loaded = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      if (!loaded) throw new Error("expected entity");
      loaded.rename("Renamed" as WorkspaceName);
      await repo.save(loaded);
      const reread = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      expect(reread?.name).toBe("Renamed");
      expect(reread?.workspaceDir).toBe(STATE_A.workspaceDir);
      expect(reread?.createdAt).toBe(STATE_A.createdAt);
    });

    it("persists markOpened — re-read shows new lastOpenedAt", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      const loaded = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      if (!loaded) throw new Error("expected entity");
      loaded.markOpened(new Date("2099-12-31T23:59:59.000Z"));
      await repo.save(loaded);
      const reread = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      expect(reread?.lastOpenedAt).toBe("2099-12-31T23:59:59.000Z");
    });
  });

  describe("delete", () => {
    it("removes the row so findById returns undefined", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      await repo.delete(STATE_A.id);
      const found = (await repo.findById(STATE_A.id))._unsafeUnwrap();
      expect(found).toBeUndefined();
    });
  });

  describe("constraint violations translate to typed errors", () => {
    it("rejects duplicate id with WorkspaceIdConflict", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      const dup = new WorkspaceEntity({ ...STATE_A, workspaceDir: "/other" });
      const res = await repo.insert(dup);
      const err = res._unsafeUnwrapErr();
      expect(err.type).toBe("WorkspaceIdConflict");
      if (err.type === "WorkspaceIdConflict") expect(err.id).toBe(STATE_A.id);
    });

    it("rejects duplicate workspaceDir with WorkspacePathConflict carrying existingId", async () => {
      await repo.insert(new WorkspaceEntity(STATE_A));
      const dup = new WorkspaceEntity({ ...STATE_B, workspaceDir: STATE_A.workspaceDir });
      const res = await repo.insert(dup);
      const err = res._unsafeUnwrapErr();
      expect(err.type).toBe("WorkspacePathConflict");
      if (err.type === "WorkspacePathConflict") {
        expect(err.workspaceDir).toBe(STATE_A.workspaceDir);
        expect(err.existingId).toBe(STATE_A.id);
      }
    });
  });
});
