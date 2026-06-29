import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { List__Entity__sUseCase } from "../../src/application/list-__entity-kebab__s.js";
import { __Entity__Entity } from "../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";
import type { __Entity__Repository } from "../../src/domain/__entity-kebab__-repository.js";

let repo: MockProxy<__Entity__Repository>;
let useCase: List__Entity__sUseCase;

beforeEach(() => {
  repo = mock<__Entity__Repository>();
  useCase = new List__Entity__sUseCase({ repo });
});

describe("List__Entity__sUseCase", () => {
  it("projects every entity to a view", async () => {
    repo.list.mockReturnValue(
      okAsync([
        new __Entity__Entity({
          id: "11111111-1111-4111-8111-111111111111" as __Entity__Id,
          name: "A",
          createdAt: "2025-01-01T00:00:00.000Z",
          archived: false,
        }),
        new __Entity__Entity({
          id: "22222222-2222-4222-8222-222222222222" as __Entity__Id,
          name: "B",
          createdAt: "2025-02-01T00:00:00.000Z",
          archived: true,
        }),
      ]),
    );
    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((v) => v.name)).toEqual(["A", "B"]);
  });

  it("returns an empty array when there are none", async () => {
    repo.list.mockReturnValue(okAsync([]));
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual([]);
  });
});
