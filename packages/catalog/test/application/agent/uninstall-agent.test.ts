import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UninstallAgentUseCase } from "../../../src/application/agent/uninstall-agent.js";
import { AgentEntity, type AgentEntityArgs } from "../../../src/domain/agent-entity.js";
import { AgentFqnSchema } from "../../../src/domain/agent-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";

const AGENT_ID = AgentFqnSchema.parse("public/triage");
const DEPENDENT_AGENT_ID = AgentFqnSchema.parse("public/reviewer");

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
let useCase: UninstallAgentUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  agentRepo = new DrizzleAgentRepository({ db });
  useCase = new UninstallAgentUseCase({
    agentRepo,
    queries: new DrizzleCatalogQueries({ db }),
  });
});

afterEach(() => {
  close();
});

describe("UninstallAgentUseCase — happy path", () => {
  it("deletes an installed agent when no installed agent depends on it", async () => {
    (await agentRepo.save(agentEntity()))._unsafeUnwrap();

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrap()).toBeUndefined();
    expect((await agentRepo.get(AGENT_ID))._unsafeUnwrapErr()).toEqual({
      type: "AgentNotFound",
      fqn: AGENT_ID,
    });
  });
});

describe("UninstallAgentUseCase — error channel", () => {
  it("propagates AgentNotFound from repo.get", async () => {
    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "AgentNotFound", fqn: AGENT_ID });
  });

  it("returns HasDependents when another agent references the target", async () => {
    (await agentRepo.save(agentEntity()))._unsafeUnwrap();
    (
      await agentRepo.save(
        agentEntity({
          fqn: DEPENDENT_AGENT_ID,
          origin: "file:///catalog/agents/reviewer",
          dependencyRefs: { skills: [], mcps: [], agents: [AGENT_ID] },
        }),
      )
    )._unsafeUnwrap();

    const res = await useCase.execute({ id: AGENT_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: AGENT_ID });
  });
});
