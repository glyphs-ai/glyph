import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/persistence/workspace.db.js";
import { WorkspaceRepository } from "../../src/persistence/workspace.repository.js";

function setupRepo(): WorkspaceRepository {
  const { db } = openDb(":memory:");
  return new WorkspaceRepository({ db });
}

let repo: WorkspaceRepository;

beforeEach(() => {
  repo = setupRepo();
});

const ROW_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alpha",
  workspaceDir: "/workspaces/alpha",
  createdAt: "2025-01-01T00:00:00.000Z",
  lastOpenedAt: "2025-01-02T00:00:00.000Z",
};

const ROW_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Beta",
  workspaceDir: "/workspaces/beta",
  createdAt: "2025-02-01T00:00:00.000Z",
  lastOpenedAt: "2025-02-03T00:00:00.000Z",
};

const ROW_C = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Gamma",
  workspaceDir: "/workspaces/gamma",
  createdAt: "2025-03-01T00:00:00.000Z",
  lastOpenedAt: "2025-01-15T00:00:00.000Z",
};

describe("WorkspaceRepository", () => {
  describe("insert + findById round-trip", () => {
    it("inserts a row and retrieves it by id", async () => {
      await repo.insert(ROW_A);
      const found = await repo.findById(ROW_A.id);
      expect(found).toEqual(ROW_A);
    });
  });

  describe("findByPath", () => {
    it("finds by workspaceDir", async () => {
      await repo.insert(ROW_A);
      const found = await repo.findByPath(ROW_A.workspaceDir);
      expect(found).toEqual(ROW_A);
    });

    it("returns undefined for unknown path", async () => {
      expect(await repo.findByPath("/unknown")).toBeUndefined();
    });
  });

  describe("findAllByLastOpened ordering", () => {
    it("returns workspaces ordered by lastOpenedAt DESC", async () => {
      await repo.insert(ROW_A);
      await repo.insert(ROW_B);
      await repo.insert(ROW_C);

      const all = await repo.findAllByLastOpened();
      // B (2025-02-03) > C (2025-01-15) > A (2025-01-02)
      expect(all.map((r) => r.id)).toEqual([ROW_B.id, ROW_C.id, ROW_A.id]);
    });
  });

  describe("findLastOpened", () => {
    it("returns the most-recently-opened workspace", async () => {
      await repo.insert(ROW_A);
      await repo.insert(ROW_B);
      const last = await repo.findLastOpened();
      expect(last?.id).toBe(ROW_B.id);
    });

    it("returns undefined on empty table", async () => {
      expect(await repo.findLastOpened()).toBeUndefined();
    });
  });

  describe("findLastOpenedId", () => {
    it("returns the id of the most-recently-opened workspace", async () => {
      await repo.insert(ROW_A);
      await repo.insert(ROW_B);
      expect(await repo.findLastOpenedId()).toBe(ROW_B.id);
    });

    it("returns undefined on empty table", async () => {
      expect(await repo.findLastOpenedId()).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates the name", async () => {
      await repo.insert(ROW_A);
      await repo.update(ROW_A.id, { name: "Renamed" });
      const found = await repo.findById(ROW_A.id);
      expect(found?.name).toBe("Renamed");
    });

    it("updates lastOpenedAt", async () => {
      await repo.insert(ROW_A);
      await repo.update(ROW_A.id, { lastOpenedAt: "2099-12-31T23:59:59.000Z" });
      const found = await repo.findById(ROW_A.id);
      expect(found?.lastOpenedAt).toBe("2099-12-31T23:59:59.000Z");
    });
  });

  describe("delete", () => {
    it("removes the row so findById returns undefined", async () => {
      await repo.insert(ROW_A);
      await repo.delete(ROW_A.id);
      expect(await repo.findById(ROW_A.id)).toBeUndefined();
    });
  });

  describe("constraint violations", () => {
    it("rejects duplicate id (PRIMARY KEY)", async () => {
      await repo.insert(ROW_A);
      const dup = { ...ROW_A, workspaceDir: "/other" };
      await expect(repo.insert(dup)).rejects.toMatchObject({
        code: expect.stringMatching(/^SQLITE_CONSTRAINT/),
      });
    });

    it("rejects duplicate workspaceDir (UNIQUE)", async () => {
      await repo.insert(ROW_A);
      const dup = { ...ROW_B, workspaceDir: ROW_A.workspaceDir };
      await expect(repo.insert(dup)).rejects.toMatchObject({
        code: expect.stringMatching(/^SQLITE_CONSTRAINT/),
      });
    });
  });
});
