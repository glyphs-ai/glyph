/** Row/entity mapper for the sessions table. */

import { SessionEntity } from "../../domain/session-entity.js";
import type { SessionId } from "../../domain/session-id.js";
import type { sessions } from "./session-schema.js";

export type SessionRow = typeof sessions.$inferSelect;

export const SessionMapper = {
  toDomain(row: SessionRow): SessionEntity {
    return new SessionEntity({
      id: row.id as SessionId,
      agent: row.agent,
      runtime: row.runtime,
      createdAt: row.createdAt,
      runtimeSessionId: row.runtimeSessionId,
      lastLaunchMode: row.lastLaunchMode,
    });
  },

  toRow(entity: SessionEntity): SessionRow {
    return {
      id: entity.id,
      agent: entity.agent,
      runtime: entity.runtime,
      createdAt: entity.createdAt,
      runtimeSessionId: entity.runtimeSessionId,
      lastLaunchMode: entity.lastLaunchMode,
    };
  },
} as const;
