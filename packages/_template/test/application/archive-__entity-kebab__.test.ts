import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { Archive__Entity__UseCase } from "../../src/application/archive-__entity-kebab__.js";
import { __Entity__Entity } from "../../src/domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../src/domain/__entity-kebab__-id.js";
import type { __Entity__Repository } from "../../src/domain/__entity-kebab__-repository.js";

const ID = "11111111-1111-4111-8111-111111111111" as __Entity__Id;

function active(): __Entity__Entity {
  return new __Entity__Entity({
    id: ID,
    name: "Demo",
    createdAt: "2025-01-01T00:00:00.000Z",
    archived: false,
  });
}

let repo: MockProxy<__Entity__Repository>;
let useCase: Archive__Entity__UseCase;

beforeEach(() => {
  repo = mock<__Entity__Repository>();
  repo.save.mockReturnValue(okAsync(undefined));
  useCase = new Archive__Entity__UseCase({ repo });
});

describe("Archive__Entity__UseCase — happy path", () => {
  it("archives the aggregate and saves it", async () => {
    repo.get.mockReturnValue(okAsync(active()));
    const view = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(view.archived).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
  });
});

describe("Archive__Entity__UseCase — error channel", () => {
  it("propagates __Entity__NotFound from repo.get", async () => {
    repo.get.mockReturnValue(errAsync({ type: "__Entity__NotFound", id: ID }));
    const res = await useCase.execute({ id: ID });
    expect(res._unsafeUnwrapErr().type).toBe("__Entity__NotFound");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("surfaces __Entity__AlreadyArchived without saving", async () => {
    repo.get.mockReturnValue(
      okAsync(
        new __Entity__Entity({
          id: ID,
          name: "Demo",
          createdAt: "2025-01-01T00:00:00.000Z",
          archived: true,
        }),
      ),
    );
    const res = await useCase.execute({ id: ID });
    expect(res._unsafeUnwrapErr().type).toBe("__Entity__AlreadyArchived");
    expect(repo.save).not.toHaveBeenCalled();
  });
});
