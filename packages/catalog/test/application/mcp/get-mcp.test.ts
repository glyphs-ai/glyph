/**
 * Read-path tests for `GetMcpUseCase`. Integration-style, matching the CQRS
 * read seam: a real in-memory catalog db is seeded through the write
 * repositories, then the use-case runs its `CatalogQueries` SELECT against it.
 * Per-call `DatabaseUnavailable` propagation is covered centrally by the
 * repository/queries layer, not re-asserted here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetMcpUseCase } from "../../../src/application/mcp/get-mcp.js";
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
const ORIGIN = "file://catalog/azure.json";
const INSTALLED_AT = "2025-01-01T00:00:00.000Z";
const UPDATED_AT = "2025-01-02T00:00:00.000Z";

function mcp(fqn: McpFqn = MCP_ID): McpEntity {
  return new McpEntity({
    fqn,
    origin: ORIGIN,
    spec: '{"_meta":{"name":"azure/mcp"}}',
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

function agentUsing(mcps: readonly string[]): AgentEntity {
  return new AgentEntity({
    fqn: "public/triage" as AgentFqn,
    origin: "file://catalog/triage/AGENTS.md",
    description: "Triage agent",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    disabledByUser: false,
    dependencyRefs: { skills: [], mcps, agents: [] },
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

function skillUsing(mcps: readonly string[]): SkillEntity {
  return new SkillEntity({
    fqn: "public/tool-use" as SkillFqn,
    origin: "file://catalog/tool-use/SKILL.md",
    description: "Tool use skill",
    version: "1.0.0",
    prereqs: undefined,
    prereqsAck: true,
    dependencyRefs: { skills: [], mcps },
    installedAt: INSTALLED_AT,
    updatedAt: UPDATED_AT,
  });
}

let db: Db;
let close: () => void;
let mcpRepo: DrizzleMcpRepository;
let agentRepo: DrizzleAgentRepository;
let skillRepo: DrizzleSkillRepository;
let useCase: GetMcpUseCase;

beforeEach(async () => {
  const opened = await openDb(":memory:");
  db = opened.db;
  close = opened.close;
  mcpRepo = new DrizzleMcpRepository({ db });
  agentRepo = new DrizzleAgentRepository({ db });
  skillRepo = new DrizzleSkillRepository({ db });
  useCase = new GetMcpUseCase({ queries: new DrizzleCatalogQueries({ db }) });
});

afterEach(() => {
  close();
});

describe("GetMcpUseCase — read paths", () => {
  it("propagates McpNotFound when the MCP is not installed", async () => {
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: MCP_ID });
  });

  it("returns the projected MCP DTO when found and unreferenced", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto).toEqual({
      fqn: MCP_ID,
      origin: ORIGIN,
      orphaned: true,
      installedAt: INSTALLED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("marks the MCP as not orphaned when an agent depends on it", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    (await agentRepo.save(agentUsing([MCP_ID])))._unsafeUnwrap();
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto.orphaned).toBe(false);
  });

  it("marks the MCP as not orphaned when a skill depends on it", async () => {
    (await mcpRepo.save(mcp()))._unsafeUnwrap();
    (await skillRepo.save(skillUsing([MCP_ID])))._unsafeUnwrap();
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto.orphaned).toBe(false);
  });
});
