import { describe, expect, it } from "vitest";
import { SessionEntity } from "../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../src/domain/session-id.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");

describe("SessionEntity.create", () => {
  it("mints a never-launched aggregate seeded from `now`", () => {
    const entity = SessionEntity.create({
      id: ID,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: "rsid-1",
      now: "2026-05-08T01:05:00.000Z",
    });
    expect(entity.id).toBe(ID);
    expect(entity.agent).toBe("public/demo");
    expect(entity.runtime).toBe("copilot");
    expect(entity.runtimeSessionId).toBe("rsid-1");
    expect(entity.createdAt).toBe("2026-05-08T01:05:00.000Z");
    expect(entity.lastLaunchMode).toBeNull();
  });
});

describe("SessionEntity — rehydration + mutation", () => {
  it("rehydrate restores a persisted lastLaunchMode", () => {
    const entity = SessionEntity.rehydrate({
      id: ID,
      agent: "public/demo",
      runtime: "copilot",
      createdAt: "2026-05-08T01:05:00.000Z",
      runtimeSessionId: null,
      lastLaunchMode: "remote",
    });
    expect(entity.lastLaunchMode).toBe("remote");
  });

  it("markLaunched records the most recent launch mode", () => {
    const entity = SessionEntity.create({
      id: ID,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: null,
      now: "2026-05-08T01:05:00.000Z",
    });
    entity.markLaunched("local");
    expect(entity.lastLaunchMode).toBe("local");
    entity.markLaunched("remote");
    expect(entity.lastLaunchMode).toBe("remote");
  });
});
