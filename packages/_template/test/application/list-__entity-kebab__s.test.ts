import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { List__Entity__sUseCase } from "../../src/application/list-__entity-kebab__s.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";
import type { Db } from "../../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { __entities__ } from "../../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { Drizzle__Entity__Queries } from "../../src/infrastructure/drizzle/__entity-kebab__-queries.js";
import { openTestDb } from "../testing.js";

let db: Db;
let close: () => void;
let useCase: List__Entity__sUseCase;

beforeEach(() => {
  const opened = openTestDb(":memory:");
  db = opened.db;
  close = opened.close;
  useCase = new List__Entity__sUseCase({ query: new Drizzle__Entity__Queries({ db }) });
});

afterEach(() => {
  close();
});

describe("List__Entity__sUseCase", () => {
  it("projects every row to a view", async () => {
    db.insert(__entities__)
      .values([
        {
          id: "22222222-2222-4222-8222-222222222222" as __Entity__Id,
          name: "B",
          createdAt: "2025-02-01T00:00:00.000Z",
          archived: true,
        },
        {
          id: "11111111-1111-4111-8111-111111111111" as __Entity__Id,
          name: "A",
          createdAt: "2025-01-01T00:00:00.000Z",
          archived: false,
        },
      ])
      .run();

    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((v) => v.name)).toEqual(["A", "B"]);
  });

  it("returns an empty array when there are none", async () => {
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual([]);
  });
});
