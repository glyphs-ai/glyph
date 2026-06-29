import { describe, expect, it } from "vitest";
import { __Entity__Entity } from "../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";

const ID = "11111111-1111-4111-8111-111111111111" as __Entity__Id;
const NOW = "2025-01-01T00:00:00.000Z";

describe("__Entity__Entity.create", () => {
  it("mints an unarchived aggregate seeded from `now`", () => {
    const e = __Entity__Entity.create({ id: ID, name: "Demo", now: NOW });
    expect(e.id).toBe(ID);
    expect(e.name).toBe("Demo");
    expect(e.createdAt).toBe(NOW);
    expect(e.archived).toBe(false);
  });
});

describe("__Entity__Entity constructor", () => {
  it("rehydrates persisted state verbatim", () => {
    const e = new __Entity__Entity({ id: ID, name: "Demo", createdAt: NOW, archived: true });
    expect(e.archived).toBe(true);
  });
});

describe("__Entity__Entity.archive", () => {
  it("archives an active aggregate", () => {
    const e = __Entity__Entity.create({ id: ID, name: "Demo", now: NOW });
    expect(e.archive().isOk()).toBe(true);
    expect(e.archived).toBe(true);
  });

  it("rejects archiving an already-archived aggregate", () => {
    const e = new __Entity__Entity({ id: ID, name: "Demo", createdAt: NOW, archived: true });
    const res = e.archive();
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("__Entity__AlreadyArchived");
  });
});
