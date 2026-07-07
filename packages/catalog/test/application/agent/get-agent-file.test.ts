import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetAgentFileUseCase } from "../../../src/application/agent/get-agent-file.js";
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
let useCase: GetAgentFileUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new GetAgentFileUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetAgentFileUseCase — read paths", () => {
  it("returns a matching file buffer", async () => {
    const content = Buffer.from("# triage");
    (await agentRepo.save(agent(), new Map([["AGENTS.md", content]])))._unsafeUnwrap();

    const buf = (await useCase.execute({ id: AGENT_ID, relPath: "AGENTS.md" }))._unsafeUnwrap();

    expect(buf).toEqual(content);
  });

  it("returns null when the file is absent", async () => {
    (
      await agentRepo.save(agent(), new Map([["AGENTS.md", Buffer.from("# triage")]]))
    )._unsafeUnwrap();

    const buf = (await useCase.execute({ id: AGENT_ID, relPath: "missing.md" }))._unsafeUnwrap();

    expect(buf).toBeNull();
  });
});
