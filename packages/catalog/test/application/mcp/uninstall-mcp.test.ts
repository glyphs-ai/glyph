import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UninstallMcpUseCase } from "../../../src/application/mcp/uninstall-mcp.js";
import { AgentEntity } from "../../../src/domain/agent-entity.js";
import type { AgentFqn } from "../../../src/domain/agent-fqn.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { SkillEntity } from "../../../src/domain/skill-entity.js";
import type { SkillFqn } from "../../../src/domain/skill-fqn.js";
import { DrizzleAgentRepository } from "../../../src/infrastructure/drizzle/agent-repository.js";
import { type Db, openDb } from "../../../src/infrastructure/drizzle/catalog-db.js";
import { DrizzleCatalogQueries } from "../../../src/infrastructure/drizzle/catalog-queries.js";
import { DrizzleMcpRepository } from "../../../src/infrastructure/drizzle/mcp-repository.js";
import { DrizzleSkillRepository } from "../../../src/infrastructure/drizzle/skill-repository.js";

const MCP_ID = "azure/mcp" as McpFqn;

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: "file://catalog/azure.json",
    spec: '{"_meta":{"name":"azure/mcp"}}',
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

function agentUsingMcp(): AgentEntity {
  return new AgentEntity({
    fqn: "public/triage" as AgentFqn,
    origin: "file:///catalog/agents/triage",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps: [MCP_ID], agents: [] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

function skillUsingMcp(): SkillEntity {
  return new SkillEntity({
    fqn: "public/tool-use" as SkillFqn,
    origin: "file:///skills/tool-use",
    description: "Tool use",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: [], mcps: [MCP_ID] },
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let db: Db;
let close: () => void;
let mcpRepo: DrizzleMcpRepository;
let agentRepo: DrizzleAgentRepository;
let skillRepo: DrizzleSkillRepository;
let useCase: UninstallMcpUseCase;

beforeEach(() => {
  const opened = openDb(":memory:");
  db = opened.db;
  close = opened.close;
  mcpRepo = new DrizzleMcpRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new UninstallMcpUseCase({
    mcpRepo,
    queries: new DrizzleCatalogQueries({ db }),
  });
});

afterEach(() => {
  close();
});

describe("UninstallMcpUseCase — mutation paths", () => {
  it("deletes an installed MCP with no dependents and returns its id", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();

    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();

    expect(dto).toEqual({ id: MCP_ID });
    expect((await mcpRepo.get(MCP_ID))._unsafeUnwrapErr()).toEqual({
      type: "McpNotFound",
      fqn: MCP_ID,
    });
  });

  it("refuses to delete when an agent depends on the MCP", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    (await agentRepo.save(agentUsingMcp()))._unsafeUnwrap();

    const res = await useCase.execute({ id: MCP_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: MCP_ID });
  });

  it("refuses to delete when a skill depends on the MCP", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    (await skillRepo.save(skillUsingMcp()))._unsafeUnwrap();

    const res = await useCase.execute({ id: MCP_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: MCP_ID });
  });
});

describe("UninstallMcpUseCase — error channel", () => {
  it("McpNotFound propagated from mcpRepo.get", async () => {
    const res = await useCase.execute({ id: MCP_ID });

    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: MCP_ID });
  });
});
