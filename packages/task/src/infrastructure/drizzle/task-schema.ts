import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persisted task row. Mirrors the `TaskEntity` (in `../../domain/task-entity.ts`)
 * field set; the `TaskMapper` (`./task-mapper.ts`) maps row ↔ entity via
 * `toEntity` / `toRow`.
 *
 * `runtime` is promoted out of `metadata` into a first-class indexed
 * column so the dashboard's runtime filter reads cleanly.
 *
 * `origin_id` is the first-class routing id for a cross-package
 * origin: the schedule id for `origin = 'schedule'` rows and the
 * workflow-node id for `origin = 'workflow'` rows. It is NULL for
 * `standalone` tasks. Promoting it out of `metadata` lets routing
 * lookups query a typed `(origin, origin_id)` pair instead of probing
 * JSON.
 *
 * **Indexes.** `tasks_origin_pair_idx` is a **composite partial
 * index** on `(origin, origin_id)` filtered `WHERE origin_id IS NOT
 * NULL`. Declared via hand-written `drizzle/0002_tasks_origin_id.sql`
 * because drizzle-kit cannot express partial indexes in schema; the
 * column itself is declared below so the planner engages the index
 * for any `WHERE origin = ? AND origin_id = ?` lookup. The same
 * hand-written-partial-index pattern is used in `@glyphs-ai/schedule`
 * for `schedules_target_agent_idx`.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    agent: text("agent").notNull(),
    runtime: text("runtime"),
    status: text("status").notNull(),
    brief: text("brief").notNull(),
    details: text("details"),
    origin: text("origin").notNull(),
    originId: text("origin_id"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    success: text("success"),
    failure: text("failure"),
    cancellation: text("cancellation"),
    metadata: text("metadata").notNull(),
  },
  (t) => [
    index("tasks_agent_idx").on(t.agent),
    index("tasks_runtime_idx").on(t.runtime),
    index("tasks_status_idx").on(t.status),
    index("tasks_origin_idx").on(t.origin),
    // tasks_origin_pair_idx is a composite partial index defined in
    // drizzle/0002_tasks_origin_id.sql ((origin, origin_id) WHERE
    // origin_id IS NOT NULL); drizzle-kit can't express partial
    // indexes in the TS schema.
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
