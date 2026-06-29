import { describe, expect, it } from "vitest";
import { AgentEntity } from "../../src/domain/agent-entity.js";
import { AgentNameSchema, AgentScopeSchema } from "../../src/domain/agent-fqn.js";

const EMPTY_DEPS = { skills: [], mcps: [], agents: [] };

function makeAgent(args?: { prereqs?: string }): AgentEntity {
  return AgentEntity.create({
    scope: AgentScopeSchema.parse("public"),
    name: AgentNameSchema.parse("triage"),
    origin: "file:/tmp/triage",
    description: "triages issues",
    version: "1.0.0",
    prereqs: args?.prereqs,
    dependencyRefs: EMPTY_DEPS,
    now: "2026-01-01T00:00:00.000Z",
  });
}

describe("AgentEntity.create", () => {
  it("mints an enabled agent", () => {
    expect(makeAgent().disabledByUser).toBe(false);
  });

  it("auto-acknowledges prereqs when none are declared", () => {
    expect(makeAgent().prereqsAck).toBe(true);
  });

  it("leaves prereqs unacknowledged when declared", () => {
    expect(makeAgent({ prereqs: "set GITHUB_TOKEN" }).prereqsAck).toBe(false);
  });

  it("seeds installedAt and updatedAt from `now`", () => {
    const a = makeAgent();
    expect(a.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(a.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("exposes id as the fqn", () => {
    expect(makeAgent().id).toBe("public/triage");
  });
});

describe("AgentEntity enable/disable", () => {
  it("disable() flips a fresh agent and returns ok", () => {
    const a = makeAgent();
    const r = a.disable();
    expect(r.isOk()).toBe(true);
    expect(a.disabledByUser).toBe(true);
  });

  it("disable() on an already-disabled agent returns AgentAlreadyDisabled", () => {
    const a = makeAgent();
    a.disable();
    const r = a.disable();
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.type).toBe("AgentAlreadyDisabled");
  });

  it("enable() on a disabled agent returns ok and flips it back", () => {
    const a = makeAgent();
    a.disable();
    const r = a.enable();
    expect(r.isOk()).toBe(true);
    expect(a.disabledByUser).toBe(false);
  });

  it("enable() on an already-enabled agent returns AgentAlreadyEnabled", () => {
    const a = makeAgent();
    const r = a.enable();
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.type).toBe("AgentAlreadyEnabled");
  });
});

describe("AgentEntity.acknowledgePrereqs", () => {
  it("marks prereqs acknowledged", () => {
    const a = makeAgent({ prereqs: "set GITHUB_TOKEN" });
    expect(a.prereqsAck).toBe(false);
    a.acknowledgePrereqs();
    expect(a.prereqsAck).toBe(true);
  });
});
