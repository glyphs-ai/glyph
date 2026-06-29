import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetMcpContentUseCase } from "../../../src/application/mcp/get-mcp-content.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";

const MCP_ID = "azure/mcp" as McpFqn;
const SPEC = '{"_meta":{"name":"azure/mcp"}}';

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: "file://catalog/azure.json",
    spec: SPEC,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let mcpRepo: MockProxy<McpRepository>;
let useCase: GetMcpContentUseCase;

beforeEach(() => {
  mcpRepo = mock<McpRepository>();
  mcpRepo.get.mockReturnValue(okAsync(mcp()));
  useCase = new GetMcpContentUseCase({ mcpRepo });
});

describe("GetMcpContentUseCase — read paths", () => {
  it("returns the MCP spec string", async () => {
    const dto = (await useCase.execute({ id: MCP_ID }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, spec: SPEC });
    expect(mcpRepo.get).toHaveBeenCalledWith(MCP_ID);
  });
});

describe("GetMcpContentUseCase — error channel", () => {
  it("McpNotFound propagated from mcpRepo.get", async () => {
    mcpRepo.get.mockReturnValue(errAsync({ type: "McpNotFound", fqn: MCP_ID }));
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: MCP_ID });
  });

  it("DatabaseUnavailable propagated from mcpRepo.get", async () => {
    mcpRepo.get.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ id: MCP_ID });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
