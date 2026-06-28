/**
 * Row ↔ Entity mapper for the workspace registry. The repository
 * delegates all shape translation here so persistence code reads as
 * pure query orchestration — `mapper.toDomain(row)` on read,
 * `mapper.toRow(entity)` on write — without inline construction or
 * field-by-field assignment in the repository.
 *
 * Row types are derived via Drizzle's `$inferSelect` — the schema is
 * the single source of truth and the TS types cannot drift from the
 * actual column definitions.
 *
 * `toDomain` builds the entity through its constructor (trusted
 * rehydration entry, no schema re-parse). `toRow` reads via the
 * entity's public getters; private state stays private.
 */

import { WorkspaceEntity } from "../../domain/workspace-entity.js";
import type { WorkspaceId } from "../../domain/workspace-id.js";
import type { WorkspaceName } from "../../domain/workspace-name.js";
import type { workspaces } from "./workspace-schema.js";

export type WorkspaceRow = typeof workspaces.$inferSelect;

export const WorkspaceMapper = {
  toDomain(row: WorkspaceRow): WorkspaceEntity {
    // Trusted rehydration: persisted rows already passed the schemas
    // on the way in, so casting raw column strings to their branded
    // value-object types is safe and re-validating would be wasted
    // work on every read.
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
