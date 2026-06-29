import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { UninstallMcpUseCase } from "../../../src/application/mcp/uninstall-mcp.js";
import type { AgentRepository } from "../../../src/domain/agent-repository.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import type { SkillRepository } from "../../../src/domain/skill-repository.js";

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

let mcpRepo: MockProxy<McpRepository>;
let agentRepo: MockProxy<AgentRepository>;
let skillRepo: MockProxy<SkillRepository>;
let useCase: UninstallMcpUseCase;

beforeEach(() => {
  mcpRepo = mock<McpRepository>();
  agentRepo = mock<AgentRepository>();
  skillRepo = mock<SkillRepository>();
  mcpRepo.get.mockReturnValue(okAsync(mcp()));
  agentRepo.existsUsingMcp.mockReturnValue(okAsync(false));
  skillRepo.existsUsingMcp.mockReturnValue(okAsync(false));
  mcpRepo.delete.mockReturnValue(okAsync(undefined));
  useCase = new UninstallMcpUseCase({ mcpRepo, agentRepo, skillRepo });
});

describe("UninstallMcpUseCase — mutation paths", () => {
  it("deletes an installed MCP with no dependents and returns its id", async () => {
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID });
    expect(mcpRepo.get).toHaveBeenCalledWith(MCP_ID);
    expect(agentRepo.existsUsingMcp).toHaveBeenCalledWith(MCP_ID);
    expect(skillRepo.existsUsingMcp).toHaveBeenCalledWith(MCP_ID);
    expect(mcpRepo.delete).toHaveBeenCalledWith(MCP_ID);
  });

  it("refuses to delete when an agent depends on the MCP", async () => {
    agentRepo.existsUsingMcp.mockReturnValue(okAsync(true));
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: MCP_ID });
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete when a skill depends on the MCP", async () => {
    skillRepo.existsUsingMcp.mockReturnValue(okAsync(true));
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "HasDependents", fqn: MCP_ID });
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });
});

describe("UninstallMcpUseCase — error channel", () => {
  it("McpNotFound propagated from mcpRepo.get", async () => {
    mcpRepo.get.mockReturnValue(errAsync({ type: "McpNotFound", fqn: MCP_ID }));
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: MCP_ID });
    expect(agentRepo.existsUsingMcp).not.toHaveBeenCalled();
    expect(skillRepo.existsUsingMcp).not.toHaveBeenCalled();
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from mcpRepo.get", async () => {
    mcpRepo.get.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from agentRepo.existsUsingMcp", async () => {
    agentRepo.existsUsingMcp.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(skillRepo.existsUsingMcp).not.toHaveBeenCalled();
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from skillRepo.existsUsingMcp", async () => {
    skillRepo.existsUsingMcp.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(mcpRepo.delete).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from mcpRepo.delete", async () => {
    mcpRepo.delete.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
