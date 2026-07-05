import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { Get__Entity__UseCase } from "../../src/application/get-__entity-kebab__.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";
import { type Db, openDb } from "../../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { Drizzle__Entity__Queries } from "../../src/infrastructure/drizzle/__entity-kebab__-queries.js";
import { __entities__ } from "../../src/infrastructure/drizzle/__entity-kebab__-schema.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as __Entity__Id;

let db: Db;
let close: () => void;
let useCase: Get__Entity__UseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  useCase = new Get__Entity__UseCase({ query: new Drizzle__Entity__Queries({ db }) });
});

afterEach(() => {
  close();
});

describe("Get__Entity__UseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as __Entity__Id })).toThrow(ZodError);
  });
});

describe("Get__Entity__UseCase — read paths", () => {
  it("returns the projected row when found", async () => {
    db.insert(__entities__)
      .values({
        id: VALID_ID,
        name: "Demo",
        createdAt: "2025-01-01T00:00:00.000Z",
        archived: false,
      })
      .run();

    const view = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(view).toEqual({
      id: VALID_ID,
      name: "Demo",
      createdAt: "2025-01-01T00:00:00.000Z",
      archived: false,
    });
  });

  it("returns null for an unknown id", async () => {
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrap()).toBeNull();
  });
});
