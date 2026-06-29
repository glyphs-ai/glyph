/** Row/entity mapper for the __Entity__ table. */

import { __Entity__Entity } from "../../domain/__entity-kebab__-entity.js";
import type { __Entity__Id } from "../../domain/__entity-kebab__-id.js";
import type { __entities__ } from "./__entity-kebab__-schema.js";

export type __Entity__Row = typeof __entities__.$inferSelect;

export const __Entity__Mapper = {
  toDomain(row: __Entity__Row): __Entity__Entity {
    return new __Entity__Entity({
      id: row.id as __Entity__Id,
      name: row.name,
      createdAt: row.createdAt,
      archived: row.archived,
    });
  },

  toRow(entity: __Entity__Entity): __Entity__Row {
    return {
      id: entity.id,
      name: entity.name,
      createdAt: entity.createdAt,
      archived: entity.archived,
    };
  },
} as const;
