import { beforeEach, describe, expect, it } from "vitest";
import { __Entity__Entity } from "../../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../../src/domain/__entity-kebab__-id.js";
import { openDb } from "../../../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { Drizzle__Entity__Repository } from "../../../src/infrastructure/drizzle/__entity-kebab__-repository.js";

function setupRepo(): Drizzle__Entity__Repository {
  const { db } = openDb(":memory:");
  return new Drizzle__Entity__Repository({ db });
}

let repo: Drizzle__Entity__Repository;

beforeEach(() => {
  repo = setupRepo();
});

const ID_A = "11111111-1111-4111-8111-111111111111" as __Entity__Id;
const ID_B = "22222222-2222-4222-8222-222222222222" as __Entity__Id;

function entityA(): __Entity__Entity {
  return new __Entity__Entity({
    id: ID_A,
    name: "Alpha",
    createdAt: "2025-01-01T00:00:00.000Z",
    archived: false,
  });
}

describe("Drizzle__Entity__Repository", () => {
  it("inserts and reads back by id", async () => {
    expect((await repo.insert(entityA())).isOk()).toBe(true);
    const found = (await repo.findById(ID_A))._unsafeUnwrap();
    expect(found).toBeInstanceOf(__Entity__Entity);
    expect(found?.name).toBe("Alpha");
  });

  it("findById returns undefined for an unknown id", async () => {
    expect((await repo.findById(ID_A))._unsafeUnwrap()).toBeUndefined();
  });

  it("get returns __Entity__NotFound for an unknown id", async () => {
    expect((await repo.get(ID_A))._unsafeUnwrapErr().type).toBe("__Entity__NotFound");
  });

  it("rejects a duplicate id with __Entity__IdConflict", async () => {
    await repo.insert(entityA());
    const dup = new __Entity__Entity({
      id: ID_A,
      name: "Other",
      createdAt: "2025-02-01T00:00:00.000Z",
      archived: false,
    });
    expect((await repo.insert(dup))._unsafeUnwrapErr().type).toBe("__Entity__IdConflict");
  });

  it("save persists a mutated aggregate", async () => {
    await repo.insert(entityA());
    const loaded = (await repo.findById(ID_A))._unsafeUnwrap();
    if (!loaded) throw new Error("expected entity");
    loaded.archive();
    await repo.save(loaded);
    expect((await repo.findById(ID_A))._unsafeUnwrap()?.archived).toBe(true);
  });

  it("delete removes the row", async () => {
    await repo.insert(entityA());
    await repo.delete(ID_A);
    expect((await repo.findById(ID_A))._unsafeUnwrap()).toBeUndefined();
  });

  it("list returns every row in creation order", async () => {
    await repo.insert(entityA());
    await repo.insert(
      new __Entity__Entity({
        id: ID_B,
        name: "Beta",
        createdAt: "2025-02-01T00:00:00.000Z",
        archived: false,
      }),
    );
    const all = (await repo.list())._unsafeUnwrap();
    expect(all.map((e) => e.id)).toEqual([ID_A, ID_B]);
  });
});
