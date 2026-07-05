import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ZodError } from "zod";
import { UnregisterWorkspaceUseCase } from "../../src/application/unregister-workspace.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceRepository } from "../../src/domain/workspace-repository.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

let repo: MockProxy<WorkspaceRepository>;
let useCase: UnregisterWorkspaceUseCase;

beforeEach(() => {
  repo = mock<WorkspaceRepository>();
  repo.delete.mockReturnValue(okAsync(undefined));
  useCase = new UnregisterWorkspaceUseCase({ repo });
});

describe("UnregisterWorkspaceUseCase — input validation", () => {
  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as WorkspaceId })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, extra: 1 } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("UnregisterWorkspaceUseCase — metadata-only delete", () => {
  it("deletes the registry row and succeeds", async () => {
    const res = await useCase.execute({ id: VALID_ID });
    expect(res.isOk()).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith(VALID_ID);
  });

  it("is idempotent on an unknown id (the SQL delete is a no-op)", async () => {
    // The drizzle adapter's DELETE affects zero rows and still resolves Ok.
    const res = await useCase.execute({ id: VALID_ID });
    expect(res.isOk()).toBe(true);
  });
});

describe("UnregisterWorkspaceUseCase — error channel", () => {
  it("propagates DatabaseUnavailable from repo.delete", async () => {
    repo.delete.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
