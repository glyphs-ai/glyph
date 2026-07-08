import { beforeEach, describe, expect, it } from "vitest";
import { SessionEntity } from "../../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../../src/domain/session-id.js";
import { DrizzleSessionRepository } from "../../../src/infrastructure/drizzle/session-repository.js";
import { openTestDb } from "../../testing.js";

async function setupRepo(): Promise<DrizzleSessionRepository> {
  const { db } = await openTestDb(":memory:");
  return new DrizzleSessionRepository({ db });
}

let repo: DrizzleSessionRepository;

beforeEach(async () => {
  repo = await setupRepo();
});

const STATE_A = {
  id: SessionIdSchema.parse("20260508-aaaaaaaa"),
  agent: "public/alpha",
  runtime: "copilot",
  runtimeSessionId: "rsid-a",
  now: "2026-05-08T00:00:00.000Z",
};

function fresh(args: typeof STATE_A): SessionEntity {
  return SessionEntity.create(args);
}

describe("DrizzleSessionRepository", () => {
  describe("save + get round-trip", () => {
    it("inserts an entity and retrieves it by id", async () => {
      const saveRes = await repo.save(fresh(STATE_A));
      expect(saveRes.isOk()).toBe(true);

      const found = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(found).toBeInstanceOf(SessionEntity);
      expect(found.id).toBe(STATE_A.id);
      expect(found.agent).toBe("public/alpha");
      expect(found.runtime).toBe("copilot");
      expect(found.createdAt).toBe("2026-05-08T00:00:00.000Z");
      expect(found.runtimeSessionId).toBe("rsid-a");
      expect(found.lastLaunchMode).toBeNull();
    });

    it("returns SessionNotFound for an unknown id", async () => {
      const res = await repo.get(STATE_A.id);
      const err = res._unsafeUnwrapErr();
      expect(err.type).toBe("SessionNotFound");
      if (err.type === "SessionNotFound") expect(err.id).toBe(STATE_A.id);
    });
  });

  describe("save (diff write of mutated aggregate)", () => {
    it("persists markLaunched — re-read shows the new launch mode", async () => {
      await repo.save(fresh(STATE_A));
      const loaded = (await repo.get(STATE_A.id))._unsafeUnwrap();
      loaded.markLaunched("remote");

      const saveRes = await repo.save(loaded);
      expect(saveRes.isOk()).toBe(true);

      const reread = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(reread.lastLaunchMode).toBe("remote");
      expect(reread.agent).toBe(STATE_A.agent);
      expect(reread.createdAt).toBe(STATE_A.now);
    });

    it("is a no-op when a loaded entity has no mutable changes", async () => {
      await repo.save(fresh(STATE_A));
      const loaded = (await repo.get(STATE_A.id))._unsafeUnwrap();

      const saveRes = await repo.save(loaded);
      expect(saveRes.isOk()).toBe(true);

      const reread = (await repo.get(STATE_A.id))._unsafeUnwrap();
      expect(reread.lastLaunchMode).toBeNull();
      expect(reread.runtimeSessionId).toBe(STATE_A.runtimeSessionId);
    });
  });

  describe("delete", () => {
    it("removes the row so get returns SessionNotFound", async () => {
      await repo.save(fresh(STATE_A));
      await repo.delete(STATE_A.id);

      const res = await repo.get(STATE_A.id);
      expect(res._unsafeUnwrapErr().type).toBe("SessionNotFound");
    });
  });

  describe("constraint violations", () => {
    it("rejects duplicate id with DatabaseUnavailable", async () => {
      await repo.save(fresh(STATE_A));
      const dup = SessionEntity.create({ ...STATE_A, agent: "public/other" });
      const res = await repo.save(dup);
      expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    });
  });
});
