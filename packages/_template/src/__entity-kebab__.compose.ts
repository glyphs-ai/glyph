import { __Entity__Service } from "./application/__entity-kebab__.service.js";
import { openDb } from "./persistence/__entity-kebab__.db.js";
import { __Entity__Repository } from "./persistence/__entity-kebab__.repository.js";

export interface __Entity__ModuleOptions {
  readonly dbFile: string;
  readonly now?: () => Date;
}

export interface __Entity__Module {
  readonly service: __Entity__Service;
  /** Closes the underlying connection. */
  close(): Promise<void>;
}

/**
 * Single composition entry point. Opens the BC's database (WAL +
 * migrations, via `openDb`) and wires up `__Entity__Service`. Production
 * callers pass the absolute `dbFile`; tests pass `":memory:"`. Unit
 * tests that need the repository in isolation can call
 * `openDb(":memory:")` directly instead of composing the whole module.
 */
export async function compose__Entity__Module(
  opts: __Entity__ModuleOptions,
): Promise<__Entity__Module> {
  const { db, close } = openDb(opts.dbFile);
  const repo = new __Entity__Repository({ db });
  const service = new __Entity__Service(
    opts.now !== undefined ? { repo, now: opts.now } : { repo },
  );
  return {
    service,
    async close() {
      close();
    },
  };
}
