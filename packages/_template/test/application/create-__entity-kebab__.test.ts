import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { Create__Entity__UseCase } from "../../src/application/create-__entity-kebab__.js";
import type { __Entity__Repository } from "../../src/domain/__entity-kebab__-repository.js";

let repo: MockProxy<__Entity__Repository>;
let useCase: Create__Entity__UseCase;

beforeEach(() => {
  repo = mock<__Entity__Repository>();
  repo.insert.mockReturnValue(okAsync(undefined));
  useCase = new Create__Entity__UseCase({ repo });
});

describe("Create__Entity__UseCase — input validation", () => {
  it("rejects an empty name with ZodError", async () => {
    expect(() => useCase.execute({ name: "" })).toThrow(ZodError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ name: "x", extra: 1 } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("Create__Entity__UseCase — happy path", () => {
  it("mints an id, inserts, and returns the view", async () => {
    const view = (await useCase.execute({ name: "Demo" }))._unsafeUnwrap();
    expect(view.name).toBe("Demo");
    expect(view.archived).toBe(false);
    expect(view.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: view.id, name: "Demo" }),
    );
  });
});

describe("Create__Entity__UseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.insert", async () => {
    repo.insert.mockReturnValue(errAsync({ type: "DatabaseUnavailable", cause: new Error("x") }));
    const res = await useCase.execute({ name: "Demo" });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
