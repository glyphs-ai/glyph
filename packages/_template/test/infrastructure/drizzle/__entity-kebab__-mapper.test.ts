import { describe, expect, it } from "vitest";
import { __Entity__Entity } from "../../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../../src/domain/__entity-kebab__-id.js";
import type { __Entity__Name } from "../../../src/domain/__entity-kebab__-name.js";
import {
  __Entity__Mapper,
  type __Entity__Row,
} from "../../../src/infrastructure/drizzle/__entity-kebab__-mapper.js";

const ROW: __Entity__Row = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo",
  createdAt: "2025-01-01T00:00:00.000Z",
  archived: false,
};

describe("__Entity__Mapper.toDomain", () => {
  it("returns an entity carrying every column", () => {
    const e = __Entity__Mapper.toDomain(ROW);
    expect(e).toBeInstanceOf(__Entity__Entity);
    expect(e.id).toBe(ROW.id);
    expect(e.name).toBe(ROW.name);
    expect(e.createdAt).toBe(ROW.createdAt);
    expect(e.archived).toBe(ROW.archived);
  });
});

describe("__Entity__Mapper.toRow", () => {
  it("round-trips with toDomain", () => {
    const e = new __Entity__Entity({
      id: "11111111-1111-4111-8111-111111111111" as __Entity__Id,
      name: "Demo" as __Entity__Name,
      createdAt: "2025-01-01T00:00:00.000Z",
      archived: false,
    });
    expect(__Entity__Mapper.toRow(e)).toEqual(ROW);
  });

  it("reflects post-archive state", () => {
    const e = new __Entity__Entity({
      id: "11111111-1111-4111-8111-111111111111" as __Entity__Id,
      name: "Demo" as __Entity__Name,
      createdAt: "2025-01-01T00:00:00.000Z",
      archived: false,
    });
    e.archive();
    expect(__Entity__Mapper.toRow(e).archived).toBe(true);
  });
});
