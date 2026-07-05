import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __Entity__Entity } from "../../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../../src/domain/__entity-kebab__-id.js";
import type { __Entity__Name } from "../../../src/domain/__entity-kebab__-name.js";
import { openDb } from "../../../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { Drizzle__Entity__Repository } from "../../../src/infrastructure/drizzle/__entity-kebab__-repository.js";

function setupRepo(): { repo: Drizzle__Entity__Repository; close(): void } {
  const { db, close } = openDb(":memory:");
  return { repo: new Drizzle__Entity__Repository({ db }), close };
}

let repo: Drizzle__Entity__Repository;
let close: () => void;

beforeEach(() => {
  const setup = setupRepo();
  repo = setup.repo;
  close = setup.close;
});

afterEach(() => {
  close();
});

const ID_A = "11111111-1111-4111-8111-111111111111" as __Entity__Id;

function entityA(): __Entity__Entity {
  return new __Entity__Entity({
    id: ID_A,
    name: "Alpha" as __Entity__Name,
    createdAt: "2025-01-01T00:00:00.000Z",
    archived: false,
  });
}

describe("Drizzle__Entity__Repository", () => {
  it("saves and reads back by id", async () => {
    expect((await repo.save(entityA())).isOk()).toBe(true);
    const found = (await repo.get(ID_A))._unsafeUnwrap();
    expect(found).toBeInstanceOf(__Entity__Entity);
    expect(found.name).toBe("Alpha");
  });

  it("get returns __Entity__NotFound for an unknown id", async () => {
    expect((await repo.get(ID_A))._unsafeUnwrapErr().type).toBe("__Entity__NotFound");
  });

  it("save upserts an existing row", async () => {
    await repo.save(entityA());
    const updated = new __Entity__Entity({
      id: ID_A,
      name: "Other" as __Entity__Name,
      createdAt: "2025-02-01T00:00:00.000Z",
      archived: true,
    });
    await repo.save(updated);
    expect((await repo.get(ID_A))._unsafeUnwrap()).toMatchObject({
      name: "Other",
      archived: true,
    });
  });

  it("save persists a mutated aggregate", async () => {
    await repo.save(entityA());
    const loaded = (await repo.get(ID_A))._unsafeUnwrap();
    loaded.archive();
    await repo.save(loaded);
    expect((await repo.get(ID_A))._unsafeUnwrap().archived).toBe(true);
  });

  it("delete removes the row", async () => {
    await repo.save(entityA());
    await repo.delete(ID_A);
    expect((await repo.get(ID_A))._unsafeUnwrapErr().type).toBe("__Entity__NotFound");
  });
});
