import type { RegisterWorkspaceRequest } from "../../src/contract/workspace.types.js";
import type { WorkspaceEntity } from "../../src/domain/workspace.entity.js";

const DEFAULT_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_NAME = "Test Workspace";
const DEFAULT_DIR = process.platform === "win32" ? "C:\\workspaces\\test" : "/workspaces/test";
const DEFAULT_CREATED_AT = "2025-01-01T00:00:00.000Z";
const DEFAULT_LAST_OPENED_AT = "2025-01-02T00:00:00.000Z";

export function aWorkspace(over: Partial<WorkspaceEntity> = {}): WorkspaceEntity {
  return {
    id: DEFAULT_ID,
    name: DEFAULT_NAME,
    workspaceDir: DEFAULT_DIR,
    createdAt: DEFAULT_CREATED_AT,
    lastOpenedAt: DEFAULT_LAST_OPENED_AT,
    ...over,
  };
}

export function aRegisterRequest(
  over: Partial<RegisterWorkspaceRequest> = {},
): RegisterWorkspaceRequest {
  return {
    name: DEFAULT_NAME,
    workspaceDir: DEFAULT_DIR,
    ...over,
  };
}
