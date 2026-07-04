import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceEntity } from "../../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../../src/domain/workspace-name.js";
import { DrizzleWorkspaceRepository } from "../../../src/infrastructure/drizzle/workspace-repository.js";
import { openTestWorkspaceDb } from "../../support/open-test-workspace-db.js";

async function setupRepo(): Promise<DrizzleWorkspaceRepository> {
  const { db } = await openTestWorkspaceDb();
  return new DrizzleWorkspaceRepository({ db });
}

let repo: DrizzleWorkspaceRepository;

beforeEach(async () => {
  repo = await setupRepo();
});

const STATE_A = {
  id: "11111111-1111-4111-8111-111111111111" as WorkspaceId,
  name: "Alpha" as WorkspaceName,
  workspaceDir: "/workspaces/alpha",
  now: "2025-01-01T00:00:00.000Z",
};

const STATE_B = {
  id: "22222222-2222-4222-8222-222222222222" as WorkspaceId,
  name: "Beta" as WorkspaceName,
  workspaceDir: "/workspaces/beta",
  now: "2025-02-01T00:00:00.000Z",
};

function fresh(args: typeof STATE_A | typeof STATE_B): WorkspaceEntity {
  return WorkspaceEntity.create(args);
}

describe("DrizzleWorkspaceRepository", () => {
  describe("save + get round-trip", () => {
    it("inserts an entity and retrieves it by id", async () => {
      const saveRes = await repo.save(fresh(STATE_A));
      expect(saveRes.isOk()).toBe(true);

      const found = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(found).toBeInstanceOf(WorkspaceEntity);
      expect(found.id).toBe(STATE_A.id);
      expect(found.name).toBe(STATE_A.name);
      expect(found.workspaceDir).toBe(STATE_A.workspaceDir);
      expect(found.createdAt).toBe(STATE_A.now);
      expect(found.lastOpenedAt).toBe(STATE_A.now);
    });

    it("returns WorkspaceNotFound for an unknown id", async () => {
      const res = await repo.get(STATE_A.id);
      const err = res._unsafeUnwrapErr();
      expect(err.type).toBe("WorkspaceNotFound");
      if (err.type === "WorkspaceNotFound") expect(err.id).toBe(STATE_A.id);
    });
  });

  describe("save (whole-entity write of mutated aggregate)", () => {
    it("persists rename — re-read shows the new name", async () => {
      await repo.save(fresh(STATE_A));
      const loaded = (await repo.get(STATE_A.id))._unsafeUnwrap();
      loaded.rename("Renamed" as WorkspaceName);

      const saveRes = await repo.save(loaded);
      expect(saveRes.isOk()).toBe(true);

      const reread = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(reread.name).toBe("Renamed");
      expect(reread.workspaceDir).toBe(STATE_A.workspaceDir);
      expect(reread.createdAt).toBe(STATE_A.now);
    });

    it("persists markOpened — re-read shows new lastOpenedAt", async () => {
      await repo.save(fresh(STATE_A));
      const loaded = (await repo.get(STATE_A.id))._unsafeUnwrap();
      loaded.markOpened(new Date("2099-12-31T23:59:59.000Z"));

      const saveRes = await repo.save(loaded);
      expect(saveRes.isOk()).toBe(true);

      const reread = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(reread.lastOpenedAt).toBe("2099-12-31T23:59:59.000Z");
    });

    it("is a no-op when a loaded entity has no mutable changes", async () => {
      await repo.save(fresh(STATE_A));
      const loaded = (await repo.get(STATE_A.id))._unsafeUnwrap();

      const saveRes = await repo.save(loaded);
      expect(saveRes.isOk()).toBe(true);

      const reread = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(reread.name).toBe(STATE_A.name);
      expect(reread.lastOpenedAt).toBe(STATE_A.now);
    });
  });

  describe("delete", () => {
    it("removes the row so get returns WorkspaceNotFound", async () => {
      await repo.save(fresh(STATE_A));
      await repo.delete(STATE_A.id);

      const res = await repo.get(STATE_A.id);
      expect(res._unsafeUnwrapErr().type).toBe("WorkspaceNotFound");
    });
  });

  describe("constraint violations", () => {
    it("rejects duplicate id with DatabaseUnavailable", async () => {
      await repo.save(fresh(STATE_A));
      const dup = WorkspaceEntity.create({ ...STATE_A, workspaceDir: "/other" });
      const res = await repo.save(dup);
      expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    });

    it("rejects duplicate workspaceDir with DatabaseUnavailable", async () => {
      await repo.save(fresh(STATE_A));
      const dup = WorkspaceEntity.create({ ...STATE_B, workspaceDir: STATE_A.workspaceDir });
      const res = await repo.save(dup);
      expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    });
  });
});
