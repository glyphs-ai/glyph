import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListAgentsUseCase } from "../../../src/application/agent/list-agents.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { McpFqnSchema } from "../../../src/domain/mcp-fqn.js";
import { SkillFqnSchema } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const asAgentFqn = (value: string) => AgentFqnSchema.parse(value);
const asSkillFqn = (value: string) => SkillFqnSchema.parse(value);
const asMcpFqn = (value: string) => McpFqnSchema.parse(value);

function agentEntity(overrides: Partial<AgentEntityArgs> = {}): AgentEntity {
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
    ...overrides,
  });
}

let db: Db;
let close: () => void;
let agentRepo: DrizzleAgentRepository;
let useCase: ListAgentsUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new ListAgentsUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("ListAgentsUseCase — read paths", () => {
  it("returns an empty array when no agents are installed", async () => {
    const dto = (await useCase.execute({}))._unsafeUnwrap();

    expect(dto).toEqual([]);
  });

  it("projects installed agents to the list DTO", async () => {
    (
      await agentRepo.save(
        agentEntity({
          disabledByUser: true,
          dependencyRefs: {
            skills: [asSkillFqn("public/tool-use")],
            mcps: [asMcpFqn("azure/mcp")],
            agents: [asAgentFqn("public/worker")],
          },
        }),
      )
    )._unsafeUnwrap();

    const dto = (await useCase.execute({}))._unsafeUnwrap();

    expect(dto).toEqual([
      {
        id: "public/triage",
        disabledByUser: true,
        skills: ["public/tool-use"],
        mcps: ["azure/mcp"],
        agents: ["public/worker"],
      },
    ]);
  });
});
