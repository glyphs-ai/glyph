/** Row/entity mapper for the workspace registry. */

import { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type { WorkspaceName } from "../../domain/workspace-name.js";
import type { WorkspaceRow } from "./workspace-db.js";

export const WorkspaceMapper = {
  toDomain(row: WorkspaceRow): WorkspaceEntity {
    // Trusted rehydration from persisted registry rows. Change-tracking is
    // the repository's concern (it snapshots the row separately).
    return WorkspaceEntity.rehydrate({
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
