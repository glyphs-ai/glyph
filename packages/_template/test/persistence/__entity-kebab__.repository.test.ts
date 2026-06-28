import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/persistence/__entity-kebab__.db.js";
import { __Entity__Repository } from "../../src/persistence/__entity-kebab__.repository.js";

// Persistence-layer integration test: exercises the real SQL against an
// in-memory database (the schema goes through the real migrator via
// `openDb`). Imports only from `persistence/` (a single src subdir), so
// per the test-layout convention this lives in `test/persistence/`.

function setupRepo(): __Entity__Repository {
  const { db } = openDb(":memory:");
  return new __Entity__Repository({ db });
}

let repo: __Entity__Repository;
beforeEach(() => {
  repo = setupRepo();
});

const ROW_A = { id: "id-a", name: "Apple", createdAt: "2025-01-01T00:00:00.000Z" };
const ROW_B = { id: "id-b", name: "Apricot", createdAt: "2025-02-01T00:00:00.000Z" };
const ROW_C = { id: "id-c", name: "Banana", createdAt: "2025-03-01T00:00:00.000Z" };

describe("__Entity__Repository", () => {
  it("insert + findById round-trips the row", async () => {
    await repo.insert(ROW_A);
    expect(await repo.findById(ROW_A.id)).toEqual(ROW_A);
  });

  it("findById returns undefined for an unknown id", async () => {
    expect(await repo.findById("missing")).toBeUndefined();
  });

  it("findAll returns all rows and filters by nameStartsWith", async () => {
    await repo.insert(ROW_A);
    await repo.insert(ROW_B);
    await repo.insert(ROW_C);
    expect((await repo.findAll()).length).toBe(3);
    const ap = await repo.findAll({ nameStartsWith: "Ap" });
    expect(ap.map((r) => r.name).sort()).toEqual(["Apple", "Apricot"]);
  });

  it("delete removes the row and is idempotent for a missing id", async () => {
    await repo.insert(ROW_A);
    await repo.delete(ROW_A.id);
    expect(await repo.findById(ROW_A.id)).toBeUndefined();
    await expect(repo.delete("missing")).resolves.toBeUndefined();
  });

  it("rejects a duplicate id (PRIMARY KEY constraint)", async () => {
    await repo.insert(ROW_A);
    await expect(repo.insert({ ...ROW_A, name: "Dup" })).rejects.toMatchObject({
      code: expect.stringMatching(/^SQLITE_CONSTRAINT/),
    });
  });
});
