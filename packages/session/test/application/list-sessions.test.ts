import type { Runtime, RuntimeRegistry, RuntimeSessionMetadata } from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { ListSessionsUseCase } from "../../src/application/list-sessions.js";
import { type RehydrateSessionArgs, SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { DatabaseUnavailable } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";
import type { Db } from "../../src/infrastructure/drizzle/session-db.js";
import { sessions } from "../../src/infrastructure/drizzle/session-db.js";
import { SessionMapper } from "../../src/infrastructure/drizzle/session-mapper.js";
import {
  DrizzleSessionQueries,
  type SessionQueries,
} from "../../src/infrastructure/drizzle/session-queries.js";
import { openTestDb } from "../testing.js";

const NEWER = SessionIdSchema.parse("20260510-aaaaaaaa");
const OLDER = SessionIdSchema.parse("20260508-bbbbbbbb");
const UNREG = SessionIdSchema.parse("20260509-cccccccc");

async function seed(db: Db, args: RehydrateSessionArgs): Promise<void> {
  await db
    .insert(sessions)
    .values(SessionMapper.toRow(SessionEntity.rehydrate(args)))
    .run();
}

function entity(
  id: string,
  runtime: string,
  createdAt: string,
  overrides: Partial<Pick<RehydrateSessionArgs, "agent" | "runtimeSessionId">> = {},
): RehydrateSessionArgs {
  return {
    id: SessionIdSchema.parse(id),
    agent: overrides.agent ?? "public/demo",
    runtime,
    createdAt,
    runtimeSessionId: overrides.runtimeSessionId ?? null,
    lastLaunchMode: null,
  };
}

async function setup(): Promise<{
  readonly db: Db;
  readonly useCase: ListSessionsUseCase;
  readonly runtimeRegistry: MockProxy<RuntimeRegistry>;
  readonly runtime: MockProxy<Runtime>;
  readonly sandbox: MockProxy<SessionSandbox>;
}> {
  const { db } = await openTestDb(":memory:");
  const runtimeRegistry = mock<RuntimeRegistry>();
  const runtime = mock<Runtime>();
  const sandbox = mock<SessionSandbox>();
  runtimeRegistry.get.mockImplementation((kind) =>
    kind === "copilot" ? ok(runtime) : err({ type: "UnknownRuntime", runtime: kind }),
  );
  runtime.readMetadata.mockReturnValue(okAsync(null));
  sandbox.resolve.mockImplementation((id) => `/ws/sessions/${id}`);
  return {
    db,
    runtimeRegistry,
    runtime,
    sandbox,
    useCase: new ListSessionsUseCase({
      query: new DrizzleSessionQueries({ db }),
      runtimeRegistry,
      sandbox,
    }),
  };
}

function failingQueries(): SessionQueries {
  return {
    sessions,
    query<T>(_fn: (db: Db) => T | Promise<T>) {
      return errAsync<T, DatabaseUnavailable>({
        type: "DatabaseUnavailable",
        cause: new Error("boom"),
      });
    },
  };
}

describe("ListSessionsUseCase", () => {
  it("drops sessions whose runtime is unregistered and sorts newest-first", async () => {
    const { db, useCase } = await setup();
    await seed(db, entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"));
    await seed(db, entity(UNREG, "gemini", "2026-05-09T00:00:00.000Z"));
    await seed(db, entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z"));

    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER, OLDER]);
  });

  it("filters by agent", async () => {
    const { db, useCase } = await setup();
    await seed(db, entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"));
    await seed(db, entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z", { agent: "public/other" }));

    const list = (await useCase.execute({ agent: "public/other" }))._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER]);
  });

  it("filters by createdSince with an inclusive lower bound", async () => {
    const { db, useCase } = await setup();
    await seed(db, entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"));
    await seed(db, entity(UNREG, "copilot", "2026-05-09T00:00:00.000Z"));
    await seed(db, entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z"));

    const list = (
      await useCase.execute({ createdSince: "2026-05-09T00:00:00.000Z" })
    )._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER, UNREG]);
  });

  it("sorts by refreshed activity newest-first", async () => {
    const { db, useCase, runtime } = await setup();
    await seed(
      db,
      entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z", { runtimeSessionId: "rsid-old" }),
    );
    await seed(
      db,
      entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z", { runtimeSessionId: "rsid-new" }),
    );
    runtime.readMetadata.mockImplementation((runtimeSessionId) => {
      const meta: RuntimeSessionMetadata = {
        title: runtimeSessionId,
        userTitled: false,
        lastActiveAt:
          runtimeSessionId === "rsid-old" ? "2026-05-11T00:00:00.000Z" : "2026-05-10T00:00:00.000Z",
      };
      return okAsync(meta);
    });

    const list = (await useCase.execute({}))._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([OLDER, NEWER]);
  });

  it("activeSince filters never-active rows on their createdAt", async () => {
    const { db, useCase } = await setup();
    await seed(db, entity(OLDER, "copilot", "2026-05-08T00:00:00.000Z"));
    await seed(db, entity(NEWER, "copilot", "2026-05-10T00:00:00.000Z"));

    const list = (
      await useCase.execute({ activeSince: "2026-05-09T00:00:00.000Z" })
    )._unsafeUnwrap();
    expect(list.map((s) => s.id)).toEqual([NEWER]);
  });

  it("propagates DatabaseUnavailable from the query", async () => {
    const runtimeRegistry = mock<RuntimeRegistry>();
    const sandbox = mock<SessionSandbox>();
    const useCase = new ListSessionsUseCase({
      query: failingQueries(),
      runtimeRegistry,
      sandbox,
    });
    expect((await useCase.execute({}))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
