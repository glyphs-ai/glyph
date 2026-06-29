import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mock } from "vitest-mock-extended";
import { InstallMcpUseCase } from "../../../src/application/mcp/install-mcp.js";
import { McpEntity } from "../../../src/domain/mcp-entity.js";
import type { McpFqn } from "../../../src/domain/mcp-fqn.js";
import { McpManifest } from "../../../src/domain/mcp-manifest.js";
import type { McpRepository } from "../../../src/domain/mcp-repository.js";
import type { Source } from "../../../src/domain/source.js";

const MCP_ID = "azure/mcp" as McpFqn;
const ORIGIN = "file://catalog/azure.json";
const OTHER_ORIGIN = "file://catalog/other-azure.json";
const SPEC = '{"_meta":{"name":"azure/mcp"}}';

function manifest(): McpManifest {
  return McpManifest.create({ _meta: { name: MCP_ID } }, SPEC)._unsafeUnwrap();
}

function existing(origin = ORIGIN): McpEntity {
  return new McpEntity({
    fqn: MCP_ID,
    origin,
    spec: SPEC,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
}

let mcpSource: MockProxy<Source<McpManifest>>;
let mcpRepo: MockProxy<McpRepository>;
let useCase: InstallMcpUseCase;

beforeEach(() => {
  mcpSource = mock<Source<McpManifest>>();
  mcpRepo = mock<McpRepository>();
  mcpSource.load.mockReturnValue(okAsync(manifest()));
  mcpRepo.get.mockReturnValue(errAsync({ type: "McpNotFound", fqn: MCP_ID }));
  mcpRepo.save.mockReturnValue(okAsync(undefined));
  useCase = new InstallMcpUseCase({ mcpSource, mcpRepo });
});

describe("InstallMcpUseCase — happy path", () => {
  it("loads a fresh MCP manifest, saves it, and returns the DTO", async () => {
    const dto = (await useCase.execute({ origin: ORIGIN }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, origin: ORIGIN });
    expect(mcpSource.load).toHaveBeenCalledWith(ORIGIN);
    expect(mcpRepo.get).toHaveBeenCalledWith(MCP_ID);
    expect(mcpRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        fqn: MCP_ID,
        origin: ORIGIN,
        spec: SPEC,
        installedAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
  });

  it("allows reinstalling an MCP from the same origin", async () => {
    mcpRepo.get.mockReturnValue(okAsync(existing(ORIGIN)));
    const dto = (await useCase.execute({ origin: ORIGIN }))._unsafeUnwrap();
    expect(dto).toEqual({ id: MCP_ID, origin: ORIGIN });
    expect(mcpRepo.save).toHaveBeenCalledTimes(1);
  });
});

describe("InstallMcpUseCase — error channel", () => {
  it("SourceError propagated from mcpSource.load", async () => {
    mcpSource.load.mockReturnValue(
      errAsync({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("offline") }),
    );
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
    expect(mcpRepo.get).not.toHaveBeenCalled();
    expect(mcpRepo.save).not.toHaveBeenCalled();
  });

  it("returns McpOriginConflict for a same-fqn install from a different origin", async () => {
    mcpRepo.get.mockReturnValue(okAsync(existing(OTHER_ORIGIN)));
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr()).toEqual({
      type: "McpOriginConflict",
      fqn: MCP_ID,
      existingOrigin: OTHER_ORIGIN,
      attemptedOrigin: ORIGIN,
    });
    expect(mcpRepo.save).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from origin guard", async () => {
    mcpRepo.get.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
    expect(mcpRepo.save).not.toHaveBeenCalled();
  });

  it("DatabaseUnavailable propagated from mcpRepo.save", async () => {
    mcpRepo.save.mockReturnValue(
      errAsync({ type: "DatabaseUnavailable", cause: new Error("boom") }),
    );
    const res = await useCase.execute({ origin: ORIGIN });
    expect(res._unsafeUnwrapErr().type).toBe("DatabaseUnavailable");
  });
});
