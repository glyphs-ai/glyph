import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetAgentContentUseCase } from "../../../src/application/agent/get-agent-content.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");

function agent(): AgentEntity {
  return new AgentEntity({
    fqn: AGENT_ID,
    origin: "file:///catalog/agents/triage",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps: [], agents: [] },
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
}

let db: Db;
let close: () => void;
let agentRepo: DrizzleAgentRepository;
let useCase: GetAgentContentUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new GetAgentContentUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetAgentContentUseCase — read paths", () => {
  it("returns anchor content for the requested agent", async () => {
    (
      await agentRepo.save(agent(), new Map([["AGENTS.md", Buffer.from("# triage")]]))
    )._unsafeUnwrap();

    const dto = (await useCase.execute({ id: AGENT_ID }))._unsafeUnwrap();

    expect(dto).toEqual({ id: AGENT_ID, content: "# triage" });
  });
});

describe("GetAgentContentUseCase — error channel", () => {
  it("propagates AgentNotFound when the anchor does not resolve", async () => {
    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
  });
});
