import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import type { Logger } from "pino";
import { applyScheduleMigrations } from "./migrations.js";
import { ScheduleRepository } from "./schedule-repository.js";
import { ScheduleService } from "./schedule-service.js";
import * as schema from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

export interface ScheduleModuleOptions {
  readonly dbFile: string;
  readonly logger?: Logger;
}

export interface ScheduleModule {
  /**
   * The composed service. Callers MUST register every kind they need
   * via {@link ScheduleService.registerKind} BEFORE calling
   * {@link ScheduleService.recover} — recover freezes the registry
   * and preflights every persisted row's `target_kind` against it,
   * throwing if any are unregistered.
   *
   * Production wiring is in `packages/api/src/workspace-context.ts`:
   *
   * ```ts
   * const scheduleModule = await composeScheduleModule({ dbFile, logger });
   * scheduleModule.service.registerKind("task", makeTaskKindHandler({ tasks, catalog }));
   * await taskModule.service.recoverOrphaned();
   * await scheduleModule.service.recover();
   * ```
   */
  readonly service: ScheduleService;
  close(): Promise<void>;
}

/**
 * Single composition entry point. Opens a better-sqlite3 connection
 * in WAL mode, runs pending migrations, and wires up
 * `ScheduleService`.
 *
 * `close()` calls `service.shutdown()` BEFORE the SQLite handle is
 * released — the in-flight setTimeout callback would otherwise hit a
 * closed db on wake.
 */
export async function composeScheduleModule(opts: ScheduleModuleOptions): Promise<ScheduleModule> {
  const sqlite: BetterSqliteDatabase = new Database(opts.dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  const db: Db = drizzle(sqlite, { schema });
  // Migration failure must close the SQLite handle before propagating:
  // a leaked handle would hold the WAL lock and break a subsequent
  // retry from the same caller (EBUSY on the lockfile / WAL files
  // until process exit). Pattern mirrored in every entity pkg.
  try {
    applyScheduleMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  const repo = new ScheduleRepository({
    db,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  const service = new ScheduleService({
    repo,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });
  return {
    service,
    async close() {
      await service.shutdown();
      sqlite.close();
    },
  };
}
