import { errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { GetLastOpenedWorkspaceIdUseCase } from "../../src/application/get-last-opened-workspace-id.js";
import { type RehydrateWorkspaceArgs, WorkspaceEntity } from "../../src/domain/workspace-entity.js";
import type { WorkspaceId } from "../../src/domain/workspace-id.js";
import type { WorkspaceName } from "../../src/domain/workspace-name.js";
import type { DatabaseUnavailable } from "../../src/domain/workspace-repository.js";
import type { Db } from "../../src/infrastructure/drizzle/workspace-db.js";
import { WorkspaceMapper } from "../../src/infrastructure/drizzle/workspace-mapper.js";
import {
  DrizzleWorkspaceQueries,
  type WorkspaceQueries,
} from "../../src/infrastructure/drizzle/workspace-queries.js";
import { workspaces } from "../../src/infrastructure/drizzle/workspace-schema.js";
import { openTestWorkspaceDb } from "../support/open-test-workspace-db.js";

const ID_A = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const ID_B = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const ID_C = "33333333-3333-4333-8333-333333333333" as WorkspaceId;

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

async function setup(): Promise<{
  readonly db: Db;
  readonly useCase: GetLastOpenedWorkspaceIdUseCase;
}> {
  const { db } = await openTestWorkspaceDb();
  return {
    db,
    useCase: new GetLastOpenedWorkspaceIdUseCase({ query: new DrizzleWorkspaceQueries({ db }) }),
  };
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

describe("GetLastOpenedWorkspaceIdUseCase — input validation", () => {
  const useCase = new GetLastOpenedWorkspaceIdUseCase({ query: failingQueries() });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ extra: 1 } as unknown as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("GetLastOpenedWorkspaceIdUseCase — read paths", () => {
  it("returns { id: null } when the registry is empty", async () => {
    const { useCase } = await setup();
    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual({ id: null });
  });

  it("returns the top id by lastOpenedAt DESC, createdAt DESC, id", async () => {
    const { db, useCase } = await setup();
    await seed(db, {
      id: ID_A,
      name: "A",
      workspaceDir: "/a",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });
    await seed(db, {
      id: ID_B,
      name: "B",
      workspaceDir: "/b",
      createdAt: "2025-02-01T00:00:00.000Z",
      lastOpenedAt: "2025-07-01T00:00:00.000Z",
    });
    await seed(db, {
      id: ID_C,
      name: "C",
      workspaceDir: "/c",
      createdAt: "2025-04-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });

    expect((await useCase.execute({}))._unsafeUnwrap()).toEqual({ id: ID_B });
  });
});

describe("GetLastOpenedWorkspaceIdUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from query", async () => {
    const useCase = new GetLastOpenedWorkspaceIdUseCase({ query: failingQueries() });
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
