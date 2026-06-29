import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { Get__Entity__UseCase } from "../../src/application/get-__entity-kebab__.js";
import { __Entity__Entity } from "../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";
import type { __Entity__Repository } from "../../src/domain/__entity-kebab__-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as __Entity__Id;

let repo: MockProxy<__Entity__Repository>;
let useCase: Get__Entity__UseCase;

beforeEach(() => {
  repo = mock<__Entity__Repository>();
  useCase = new Get__Entity__UseCase({ repo });
});

describe("Get__Entity__UseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    await expect(useCase.execute({ id: "bad" as __Entity__Id })).rejects.toThrow(ZodError);
  });
});

describe("Get__Entity__UseCase — read paths", () => {
  it("returns the projected view when found", async () => {
    repo.get.mockReturnValue(
      okAsync(
        new __Entity__Entity({
          id: VALID_ID,
          name: "Demo",
          createdAt: "2025-01-01T00:00:00.000Z",
          archived: false,
        }),
      ),
    );
    const view = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(view).toEqual({
      id: VALID_ID,
      name: "Demo",
      createdAt: "2025-01-01T00:00:00.000Z",
      archived: false,
    });
  });

  it("propagates __Entity__NotFound from repo.get", async () => {
    repo.get.mockReturnValue(errAsync({ type: "__Entity__NotFound", id: VALID_ID }));
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("__Entity__NotFound");
  });
});
