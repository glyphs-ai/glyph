import { errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ListWorkspacesUseCase } from "../../src/application/list-workspaces.js";
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
const ID_D = "00000000-0000-4000-8000-000000000000" as WorkspaceId;

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

async function setup(): Promise<{ readonly db: Db; readonly useCase: ListWorkspacesUseCase }> {
  const { db } = await openTestWorkspaceDb();
  return { db, useCase: new ListWorkspacesUseCase({ query: new DrizzleWorkspaceQueries({ db }) }) };
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

describe("ListWorkspacesUseCase — input validation", () => {
  const useCase = new ListWorkspacesUseCase({ query: failingQueries() });

  it("rejects an unknown key (strict)", async () => {
    expect(() =>
      useCase.execute({ extra: "x" } as unknown as Parameters<typeof useCase.execute>[0]),
    ).toThrow(ZodError);
  });
});

describe("ListWorkspacesUseCase — read paths", () => {
  it("returns an empty array when no workspaces are registered", async () => {
    const { useCase } = await setup();
    const res = await useCase.execute({});
    expect(res._unsafeUnwrap()).toEqual([]);
  });

  it("projects rows ordered by lastOpenedAt DESC, createdAt DESC, id", async () => {
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
    await seed(db, {
      id: ID_D,
      name: "D",
      workspaceDir: "/d",
      createdAt: "2025-04-01T00:00:00.000Z",
      lastOpenedAt: "2025-06-01T00:00:00.000Z",
    });

    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((workspace) => workspace.id)).toEqual([ID_B, ID_D, ID_C, ID_A]);
    expect(list[0]?.name).toBe("B");
    expect(list[0]?.lastOpenedAt).toBe("2025-07-01T00:00:00.000Z");
  });

  it("coalesces null lastOpenedAt to createdAt at the projection boundary", async () => {
    const { db, useCase } = await setup();
    await seed(db, {
      id: ID_A,
      name: "A",
      workspaceDir: "/a",
      createdAt: "2025-03-01T00:00:00.000Z",
      lastOpenedAt: null,
    });

    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list).toHaveLength(1);
    expect(list[0]?.lastOpenedAt).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("ListWorkspacesUseCase — error channel", () => {
  it("DatabaseUnavailable propagated from query", async () => {
    const useCase = new ListWorkspacesUseCase({ query: failingQueries() });
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
