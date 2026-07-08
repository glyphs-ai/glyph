import type { ResultSet } from "@libsql/client";
import { type BaseSQLiteDatabase, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persisted session row — the slice that survives across server
 * lifetimes (runtime kind, agent FQN, optional runtime session id, last
 * launch mode). Live activity (lastActiveAt / preview / workdir) is
 * recomputed per read from the runtime + workspace layout.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    agent: text("agent").notNull(),
    runtime: text("runtime").notNull(),
    createdAt: text("created_at").notNull(),
    runtimeSessionId: text("runtime_session_id"),
    lastLaunchMode: text("last_launch_mode", { enum: ["local", "remote"] }),
  },
  (t) => [index("sessions_agent_idx").on(t.agent)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

/**
 * The pkg's drizzle DB handle, parameterized by the sessions table above.
 * A request-scoped drizzle transaction also satisfies this type, so
 * repositories and queries stay unaware of whether they run inside one.
 */
export type Db = BaseSQLiteDatabase<"async", ResultSet, typeof import("./session-db.js")>;
