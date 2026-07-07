import type { Runtime, RuntimeRegistry, RuntimeSessionMetadata } from "@glyphs-ai/runtime";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetSessionUseCase } from "../../src/application/get-session.js";
import { type RehydrateSessionArgs, SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";
import type { DatabaseUnavailable } from "../../src/domain/session-repository.js";
import type { SessionSandbox } from "../../src/domain/session-sandbox.js";
import type { Db } from "../../src/infrastructure/drizzle/session-db.js";
import { openDb } from "../../src/infrastructure/drizzle/session-db.js";
import { SessionMapper } from "../../src/infrastructure/drizzle/session-mapper.js";
import {
  DrizzleSessionQueries,
  type SessionQueries,
} from "../../src/infrastructure/drizzle/session-queries.js";
import { sessions } from "../../src/infrastructure/drizzle/session-schema.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");
const WORKDIR = `/ws/sessions/${ID}`;

async function seed(db: Db, args: RehydrateSessionArgs): Promise<void> {
  await db
    .insert(sessions)
    .values(SessionMapper.toRow(SessionEntity.rehydrate(args)))
    .run();
}

function entity(runtimeSessionId: string | null): RehydrateSessionArgs {
  return {
    id: ID,
    agent: "public/demo",
    runtime: "copilot",
    createdAt: "2026-05-08T01:05:00.000Z",
    runtimeSessionId,
    lastLaunchMode: null,
  };
}

async function setup(): Promise<{
  readonly db: Db;
  readonly useCase: GetSessionUseCase;
  readonly runtimeRegistry: MockProxy<RuntimeRegistry>;
  readonly runtime: MockProxy<Runtime>;
  readonly sandbox: MockProxy<SessionSandbox>;
}> {
  const { db } = await openDb(":memory:");
  const runtimeRegistry = mock<RuntimeRegistry>();
  const runtime = mock<Runtime>();
  const sandbox = mock<SessionSandbox>();
  runtimeRegistry.get.mockReturnValue(ok(runtime));
  runtime.readMetadata.mockReturnValue(okAsync(null));
  sandbox.resolve.mockReturnValue(WORKDIR);
  return {
    db,
    runtimeRegistry,
    runtime,
    sandbox,
    useCase: new GetSessionUseCase({
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

describe("GetSessionUseCase", () => {
  it("returns null when the session is absent", async () => {
    const { useCase } = await setup();
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("returns null when the session's runtime is no longer registered", async () => {
    const { db, useCase, runtimeRegistry } = await setup();
    await seed(db, entity("rsid-1"));
    runtimeRegistry.get.mockReturnValue(err({ type: "UnknownRuntime", runtime: "copilot" }));
    expect((await useCase.execute({ id: ID }))._unsafeUnwrap()).toBeNull();
  });

  it("projects the base view when there is no runtime session yet", async () => {
    const { db, useCase, runtime } = await setup();
    await seed(db, entity(null));
    const view = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(view).toEqual({
      id: ID,
      workdir: WORKDIR,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: null,
      createdAt: "2026-05-08T01:05:00.000Z",
      lastActiveAt: null,
      preview: null,
      lastLaunchMode: null,
    });
    expect(runtime.readMetadata).not.toHaveBeenCalled();
  });

  it("refreshes lastActiveAt + preview from live runtime metadata", async () => {
    const { db, useCase, runtime } = await setup();
    await seed(db, entity("rsid-1"));
    const meta: RuntimeSessionMetadata = {
      title: "Draft the post",
      userTitled: false,
      lastActiveAt: "2026-05-08T02:00:00.000Z",
    };
    runtime.readMetadata.mockReturnValue(okAsync(meta));
    const view = (await useCase.execute({ id: ID }))._unsafeUnwrap();
    expect(view?.preview).toBe("Draft the post");
    expect(view?.lastActiveAt).toBe("2026-05-08T02:00:00.000Z");
  });

  it("propagates DatabaseUnavailable from the query", async () => {
    const runtimeRegistry = mock<RuntimeRegistry>();
    const sandbox = mock<SessionSandbox>();
    const useCase = new GetSessionUseCase({
      query: failingQueries(),
      runtimeRegistry,
      sandbox,
    });
    expect((await useCase.execute({ id: ID }))._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
