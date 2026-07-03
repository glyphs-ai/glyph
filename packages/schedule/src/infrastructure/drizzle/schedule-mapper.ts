import { err, ok, type Result } from "neverthrow";
import { ScheduleEntity } from "../../domain/schedule/schedule-entity.js";
import type { ScheduleCorruption } from "../../domain/schedule/schedule-errors.js";
import { ScheduleIdSchema } from "../../domain/schedule/schedule-id.js";
import type { ScheduleTargetEnvelope } from "../../domain/schedule/schedule-target.js";
import type { ScheduleTrigger } from "../../domain/schedule/schedule-trigger.js";
import type { NewScheduleRow, ScheduleRow } from "./schedule-schema.js";

/**
 * Row ↔ entity mapping for the schedules table. The write side
 * (repository) uses {@link toRow}; {@link toEntity} rehydrates a persisted
 * row, returning {@link ScheduleCorruption} when the row violates the
 * stored grammar (unknown trigger kind, malformed id, non-JSON target).
 *
 * Read use-cases project rows → views directly (each owns its own
 * projection); the mapper is only the entity boundary for the repo.
 */
export const ScheduleMapper = {
  /**
   * Project an entity to a row. `target_json` stores the DATA payload only,
   * not the full envelope — `kind` already lives in `target_kind`. Double-
   * encoding it inside the JSON would make reads pay for a redundant
   * parse/destructure and would let a row whose `target_kind` disagreed
   * with the JSON `kind` slip through.
   */
  toRow(entity: ScheduleEntity): NewScheduleRow {
    return {
      id: entity.id,
      name: entity.name,
      triggerKind: entity.trigger.kind,
      triggerExpr: entity.trigger.expr,
      triggerTz: entity.trigger.tz,
      targetKind: entity.target.kind,
      targetJson: JSON.stringify(entity.target.data),
      enabled: entity.enabled,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      lastFiredAt: entity.lastFiredAt ?? null,
      nextFireAt: entity.nextFireAt ?? null,
    };
  },

  /** Rehydrate an entity from a row, or {@link ScheduleCorruption} on a bad row. */
  toEntity(row: ScheduleRow): Result<ScheduleEntity, ScheduleCorruption> {
    const id = ScheduleIdSchema.safeParse(row.id);
    if (!id.success) {
      return err({ type: "ScheduleCorruption", id: row.id, reason: "invalid schedule id" });
    }
    return parseTrigger(row).andThen((trigger) =>
      parseTarget(row).map((target) =>
        ScheduleEntity.rehydrate({
          id: id.data,
          name: row.name,
          trigger,
          target,
          enabled: row.enabled,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(row.lastFiredAt !== null ? { lastFiredAt: row.lastFiredAt } : {}),
          ...(row.nextFireAt !== null ? { nextFireAt: row.nextFireAt } : {}),
        }),
      ),
    );
  },
} as const;

function parseTrigger(row: ScheduleRow): Result<ScheduleTrigger, ScheduleCorruption> {
  if (row.triggerKind !== "cron") {
    return err({
      type: "ScheduleCorruption",
      id: row.id,
      reason: `unknown trigger_kind="${row.triggerKind}"`,
    });
  }
  return ok({ kind: "cron", expr: row.triggerExpr, tz: row.triggerTz });
}

/**
 * Hydrate the envelope from a row. Generic: `kind` comes straight from the
 * `target_kind` column and `data` is `JSON.parse`d as unknown. Persisted
 * data is trusted (validated by the handler at create / patch time); the
 * substrate does NOT re-run `handler.validate` on reads.
 */
function parseTarget(row: ScheduleRow): Result<ScheduleTargetEnvelope, ScheduleCorruption> {
  let data: unknown;
  try {
    data = JSON.parse(row.targetJson);
  } catch (cause) {
    return err({
      type: "ScheduleCorruption",
      id: row.id,
      reason: `target_json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  return ok({ kind: row.targetKind, data });
}
