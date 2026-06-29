/** Row/entity mapper for the workspace registry. */

import { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type { WorkspaceName } from "../../domain/workspace-name.js";
import type { workspaces } from "./workspace-schema.js";

export type WorkspaceRow = typeof workspaces.$inferSelect;

export const WorkspaceMapper = {
  toDomain(row: WorkspaceRow): WorkspaceEntity {
    // Trusted rehydration from persisted registry rows.
    return new WorkspaceEntity({
      id: row.id as WorkspaceId,
      workspaceDir: row.workspaceDir,
      name: row.name as WorkspaceName,
      createdAt: row.createdAt,
      lastOpenedAt: row.lastOpenedAt,
    });
  },

  toRow(entity: WorkspaceEntity): WorkspaceRow {
    return {
      id: entity.id,
      workspaceDir: entity.workspaceDir,
      name: entity.name,
      createdAt: entity.createdAt,
      lastOpenedAt: entity.lastOpenedAt,
    };
  },
} as const;
