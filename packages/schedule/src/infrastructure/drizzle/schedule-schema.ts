import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persisted row for one schedule. Single table + JSON `target_json`
 * column (single-table envelope storage): target payloads are small,
 * stable, and isolated by `target_kind`.
 *
 * **Indexes.** `schedules_target_agent_idx` is a functional partial
 * index on `json_extract(target_json, '$.agent')` filtered to
 * `target_kind = 'task'`. drizzle-kit cannot express a functional
 * partial index in the TS schema, so it is declared in a hand-written
 * migration; a query engages it only when it filters on both
 * `target_kind = 'task'` and the same `json_extract(target_json, '$.agent')`
 * expression (the list use-case does this for its list-by-agent filter).
 *
 * `next_fire_at` is persisted (despite being derivable from
 * trigger + last_fired_at) so the list query can ORDER BY
 * next_fire_at without an N×cron-compute per request. It is recomputed
 * whenever a schedule's next fire changes (create, patch, fire, run,
 * recover).
 *
 * No DB-level FK to `agents` — validation is application-level: the
 * registered `ScheduleKindHandler` owns the existence lookup for
 * whatever entity its kind references, run during its `validate`.
 */
export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    triggerExpr: text("trigger_expr").notNull(),
    triggerTz: text("trigger_tz").notNull(),
    targetKind: text("target_kind").notNull(),
    targetJson: text("target_json").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastFiredAt: text("last_fired_at"),
    nextFireAt: text("next_fire_at"),
  },
  (t) => [
    index("schedules_enabled_idx").on(t.enabled),
    index("schedules_next_fire_idx").on(t.nextFireAt),
    // schedules_target_agent_idx (a functional partial index over
    // json_extract(target_json, '$.agent') filtered to target_kind='task')
    // is declared in a hand-written migration; drizzle-kit can't express a
    // functional partial index in the TS schema.
  ],
);

export type ScheduleRow = typeof schedules.$inferSelect;
export type NewScheduleRow = typeof schedules.$inferInsert;
