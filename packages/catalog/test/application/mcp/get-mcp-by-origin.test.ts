import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { GetMcpByOriginUseCase } from "../../../src/application/mcp/get-mcp-by-origin.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";

const MCP_ID = "azure/mcp" as McpFqn;
const ORIGIN = "file://catalog/azure.json";
const SPEC = '{"_meta":{"name":"azure/mcp"}}';

function mcp(): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin: ORIGIN,
    spec: SPEC,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let mcpRepo: MockProxy<McpRepository>;
let useCase: GetMcpByOriginUseCase;

beforeEach(() => {
  mcpRepo = mock<McpRepository>();
  mcpRepo.getByOrigin.mockReturnValue(okAsync(mcp()));
  useCase = new GetMcpByOriginUseCase({ mcpRepo });
});

describe("GetMcpByOriginUseCase — read paths", () => {
  it("returns the projected MCP content DTO for the origin", async () => {
    const dto = (await useCase.execute({ origin: ORIGIN }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, origin: ORIGIN, spec: SPEC });
    expect(mcpRepo.getByOrigin).toHaveBeenCalledWith(ORIGIN);
  });
});

describe("GetMcpByOriginUseCase — error channel", () => {
  it("McpNotFound propagated from mcpRepo.getByOrigin", async () => {
    mcpRepo.getByOrigin.mockReturnValue(errAsync({ type: "McpNotFound", fqn: ORIGIN }));
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toEqual({ type: "McpNotFound", fqn: ORIGIN });
  });

  it("DatabaseUnavailable propagated from mcpRepo.getByOrigin", async () => {
    mcpRepo.getByOrigin.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
