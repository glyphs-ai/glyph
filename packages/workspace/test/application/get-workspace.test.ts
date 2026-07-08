import { errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { GetWorkspaceUseCase } from "../../src/application/get-workspace.js";
import { type RehydrateWorkspaceArgs, WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { DatabaseUnavailable } from "../../src/domain/workspace-repository.js";
import type { Db } from "../../src/infrastructure/drizzle/workspace-db.js";
import { workspaces } from "../../src/infrastructure/drizzle/workspace-db.js";
import { WorkspaceMapper } from "../../src/infrastructure/drizzle/workspace-mapper.js";
import {
  DrizzleWorkspaceQueries,
  type WorkspaceQueries,
} from "../../src/infrastructure/drizzle/workspace-queries.js";
import { openTestWorkspaceDb } from "../support/open-test-workspace-db.js";

const VALID_ID = "11111111-1111-4111-8111-111111111111" as WorkspaceId;

type SeedWorkspaceArgs = Omit<RehydrateWorkspaceArgs, "name"> & { readonly name: string };

async function seed(db: Db, args: SeedWorkspaceArgs): Promise<void> {
  await db
    .insert(workspaces)
    .values(
      WorkspaceMapper.toRow(
        WorkspaceEntity.rehydrate({ ...args, name: args.name as WorkspaceName }),
      ),
    )
    .run();
}

async function setup(): Promise<{ readonly db: Db; readonly useCase: GetWorkspaceUseCase }> {
  const { db } = await openTestWorkspaceDb();
  return { db, useCase: new GetWorkspaceUseCase({ query: new DrizzleWorkspaceQueries({ db }) }) };
}

function failingQueries(): WorkspaceQueries {
  return {
    workspaces,
    query<T>(_fn: (db: Db) => T | Promise<T>) {
      return errAsync<T, DatabaseUnavailable>({
        type: "DatabaseUnavailable",
        cause: new Error("boom"),
      });
    },
  };
}

describe("GetWorkspaceUseCase — input validation", () => {
  const useCase = new GetWorkspaceUseCase({ query: failingQueries() });

  it("rejects a malformed id with ZodError", async () => {
    expect(() => useCase.execute({ id: "bad" as WorkspaceId })).toThrow(ZodError);
  });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ id: VALID_ID, extra: "x" } as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("GetWorkspaceUseCase — read paths", () => {
  it("returns null when the workspace is not registered", async () => {
    const { useCase } = await setup();
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrap()).toBeNull();
  });

  it("returns the projected Workspace DTO when found", async () => {
    const { db, useCase } = await setup();
    await seed(db, {
      id: VALID_ID,
      name: "Demo",
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });

    const dto = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(dto).toEqual({
      id: VALID_ID,
      name: "Demo",
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });
  });

  it("coalesces null lastOpenedAt to createdAt at the projection boundary", async () => {
    const { db, useCase } = await setup();
    await seed(db, {
      id: VALID_ID,
      name: "Demo",
      workspaceDir: "/x",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    });

    const dto = (await useCase.execute({ id: VALID_ID }))._unsafeUnwrap();
    expect(dto?.lastOpenedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("GetWorkspaceUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from query", async () => {
    const useCase = new GetWorkspaceUseCase({ query: failingQueries() });
    const res = await useCase.execute({ id: VALID_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
