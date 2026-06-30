import { describe, expect, it } from "vitest";
import { SessionEntity } from "../../../src/domain/session-entity.js";
import { SessionIdSchema } from "../../../src/domain/session-id.js";
import { SessionMapper } from "../../../src/infrastructure/drizzle/session-mapper.js";

const ID = SessionIdSchema.parse("20260508-9dfbdf05");

describe("SessionMapper", () => {
  it("round-trips an entity through toRow → toDomain", () => {
    const entity = new SessionEntity({
      id: ID,
      agent: "public/demo",
      runtime: "copilot",
      createdAt: "2026-05-08T01:05:00.000Z",
      runtimeSessionId: "rsid-1",
      lastLaunchMode: "remote",
    });
    const back = SessionMapper.toDomain(SessionMapper.toRow(entity));
    expect(back).toBeInstanceOf(SessionEntity);
    expect(back.id).toBe(ID);
    expect(back.agent).toBe("public/demo");
    expect(back.runtime).toBe("copilot");
    expect(back.createdAt).toBe("2026-05-08T01:05:00.000Z");
    expect(back.runtimeSessionId).toBe("rsid-1");
    expect(back.lastLaunchMode).toBe("remote");
  });

  it("preserves a null runtimeSessionId / lastLaunchMode", () => {
    const entity = SessionEntity.create({
      id: ID,
      agent: "public/demo",
      runtime: "copilot",
      runtimeSessionId: null,
      now: "2026-05-08T01:05:00.000Z",
    });
    const row = SessionMapper.toRow(entity);
    expect(row.runtimeSessionId).toBeNull();
    expect(row.lastLaunchMode).toBeNull();
  });
});
