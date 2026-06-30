import { beforeEach, describe, expect, it } from "vitest";
import { SessionEntity } from "../../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../../src/domain/session-id.js";
import { openDb } from "../../../src/infrastructure/drizzle/session-db.js";
import { DrizzleSessionRepository } from "../../../src/infrastructure/drizzle/session-repository.js";

function setupRepo(): DrizzleSessionRepository {
  const { db } = openDb(":memory:");
  return new DrizzleSessionRepository({ db });
}

const ID_A = SessionIdSchema.parse("20260508-aaaaaaaa");
const ID_B = SessionIdSchema.parse("20260509-bbbbbbbb");

function sessionA(): SessionEntity {
  return new SessionEntity({
    id: ID_A,
    agent: "public/alpha",
    runtime: "copilot",
    createdAt: "2026-05-08T00:00:00.000Z",
    runtimeSessionId: "rsid-a",
    lastLaunchMode: null,
  });
}

function sessionB(): SessionEntity {
  return new SessionEntity({
    id: ID_B,
    agent: "public/beta",
    runtime: "copilot",
    createdAt: "2026-05-09T00:00:00.000Z",
    runtimeSessionId: null,
    lastLaunchMode: null,
  });
}

let repo: DrizzleSessionRepository;

beforeEach(() => {
  repo = setupRepo();
});

describe("DrizzleSessionRepository", () => {
  it("inserts an entity and retrieves it by id", async () => {
    expect((await repo.insert(sessionA())).isOk()).toBe(true);
    const found = (await repo.findById(ID_A))._unsafeUnwrap();
    expect(found).toBeInstanceOf(SessionEntity);
    expect(found?.agent).toBe("public/alpha");
    expect(found?.runtimeSessionId).toBe("rsid-a");
  });

  it("findById returns undefined for an unknown id", async () => {
    expect((await repo.findById(ID_A))._unsafeUnwrap()).toBeUndefined();
  });

  it("get returns SessionNotFound for an unknown id", async () => {
    expect((await repo.get(ID_A))._unsafeUnwrapErr()).toEqual({
      type: "SessionNotFound",
      id: ID_A,
    });
  });

  it("insert of a duplicate id yields SessionIdConflict", async () => {
    await repo.insert(sessionA());
    expect((await repo.insert(sessionA()))._unsafeUnwrapErr()).toEqual({
      type: "SessionIdConflict",
      id: ID_A,
    });
  });

  it("findAll filters by agent", async () => {
    await repo.insert(sessionA());
    await repo.insert(sessionB());
    const rows = (await repo.findAll({ agent: "public/beta" }))._unsafeUnwrap();
    expect(rows.map((r) => r.id)).toEqual([ID_B]);
  });

  it("findAll filters by createdSince (inclusive lower bound)", async () => {
    await repo.insert(sessionA());
    await repo.insert(sessionB());
    const rows = (await repo.findAll({ createdSince: "2026-05-09T00:00:00.000Z" }))._unsafeUnwrap();
    expect(rows.map((r) => r.id)).toEqual([ID_B]);
  });

  it("save persists a mutated launch mode", async () => {
    const entity = sessionA();
    await repo.insert(entity);
    entity.markLaunched("remote");
    expect((await repo.save(entity)).isOk()).toBe(true);
    expect((await repo.get(ID_A))._unsafeUnwrap().lastLaunchMode).toBe("remote");
  });

  it("delete removes the row", async () => {
    await repo.insert(sessionA());
    await repo.delete(ID_A);
    expect((await repo.findById(ID_A))._unsafeUnwrap()).toBeUndefined();
  });
});
