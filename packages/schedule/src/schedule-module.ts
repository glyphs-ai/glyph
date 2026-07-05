import { randomUUID as cryptoRandomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import { CreateScheduleUseCase } from "./application/create-schedule.js";
import { DeleteScheduleUseCase } from "./application/delete-schedule.js";
import { ScheduleEngine } from "./application/engine/schedule-engine.js";
import { GetScheduleUseCase } from "./application/get-schedule.js";
import { ListSchedulesUseCase } from "./application/list-schedules.js";
import { PatchScheduleUseCase } from "./application/patch-schedule.js";
import { DefaultScheduleKindRegistry } from "./application/ports/schedule-kind-registry.js";
import { PreviewScheduleUseCase } from "./application/preview-schedule.js";
import { RunScheduleUseCase } from "./application/run-schedule.js";
import { type Db, openDb } from "./infrastructure/drizzle/schedule-db.js";
import { DrizzleScheduleQueries } from "./infrastructure/drizzle/schedule-queries.js";
import { DrizzleScheduleRepository } from "./infrastructure/drizzle/schedule-repository.js";
import * as schema from "./infrastructure/drizzle/schedule-schema.js";

/**
 * Public surface of `@glyphs-ai/schedule`: a DI container of use-case instances
 * plus the stateful {@link ScheduleEngine}. Consumers call
 * `module.<useCase>.execute(...)`; there is no service facade.
 *
 * The engine is the single stateful dependency (timers + open registry). Hosts
 * drive its lifecycle: register every kind via `engine.registerKind(...)` BEFORE
 * `engine.recover()` (recover freezes the registry and preflights every row's
 * `target_kind`). `close()` shuts the engine down (clearing timers, awaiting
 * in-flight fires) BEFORE releasing the SQLite handle — an in-flight fire
 * callback would otherwise wake onto a closed db.
 */
export interface ScheduleModule {
  readonly createSchedule: CreateScheduleUseCase;
  readonly patchSchedule: PatchScheduleUseCase;
  readonly deleteSchedule: DeleteScheduleUseCase;
  readonly runSchedule: RunScheduleUseCase;
  readonly getSchedule: GetScheduleUseCase;
  readonly listSchedules: ListSchedulesUseCase;
  readonly previewSchedule: PreviewScheduleUseCase;
  /** The stateful scheduler; hosts drive registerKind / recover / shutdown. */
  readonly engine: ScheduleEngine;
  /** Shut the engine down, then close the module-owned SQLite connection. */
  close(): Promise<void>;
}

export type ScheduleModuleOptions = (
  | { readonly db: Db; readonly dbFile?: never }
  | { readonly dbFile: string; readonly db?: never }
) & {
  readonly logger?: Logger;
  /** Test seam: clock for id generation + timestamps. */
  readonly now?: () => Date;
  /** Test seam: UUID source seeding `generateScheduleId`. */
  readonly randomUUID?: () => string;
};

/**
 * Open the schedule DB (WAL + migrations) and assemble the module. Production
 * callers pass `dbFile` (the per-workspace `workspace.db`); tests pass an
 * existing `db` (e.g. `:memory:`) which the module does NOT close.
 */
export async function composeScheduleModule(opts: ScheduleModuleOptions): Promise<ScheduleModule> {
  const logger = opts.logger ?? pino({ level: "silent" });
  const now = opts.now ?? (() => new Date());
  const randomUUID = opts.randomUUID ?? cryptoRandomUUID;

  let db: Db;
  let closeDb: () => void;
  if ("db" in opts && opts.db !== undefined) {
    db = opts.db;
    closeDb = () => {};
  } else {
    const opened = openDb(opts.dbFile as string);
    db = opened.db;
    closeDb = opened.close;
  }

  const registry = new DefaultScheduleKindRegistry();
  const repo = new DrizzleScheduleRepository({ db });
  const queries = new DrizzleScheduleQueries({ db });
  const engine = new ScheduleEngine({ repo, queries, registry, logger, now });

  return {
    createSchedule: new CreateScheduleUseCase({ repo, registry, engine, now, randomUUID }),
    patchSchedule: new PatchScheduleUseCase({ repo, registry, engine, now }),
    deleteSchedule: new DeleteScheduleUseCase({ repo, registry, engine }),
    runSchedule: new RunScheduleUseCase({ repo, registry, now }),
    getSchedule: new GetScheduleUseCase({ query: queries }),
    listSchedules: new ListSchedulesUseCase({ query: queries }),
    previewSchedule: new PreviewScheduleUseCase({ now }),
    engine,
    async close() {
      await engine.shutdown();
      closeDb();
    },
  };
}

export type { Db };
export { schema };
