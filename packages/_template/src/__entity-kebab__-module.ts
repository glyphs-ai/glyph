import { Archive__Entity__UseCase } from "./application/archive-__entity-kebab__.js";
import { Create__Entity__UseCase } from "./application/create-__entity-kebab__.js";
import { Get__Entity__UseCase } from "./application/get-__entity-kebab__.js";
import { List__Entity__sUseCase } from "./application/list-__entity-kebab__s.js";
import type { Db } from "./infrastructure/drizzle/__entity-kebab__-db.js";
import { Drizzle__Entity__Queries } from "./infrastructure/drizzle/__entity-kebab__-queries.js";
import { Drizzle__Entity__Repository } from "./infrastructure/drizzle/__entity-kebab__-repository.js";

/**
 * Public surface of the __PKG__ package: a DI container of use-case
 * instances plus `close`. The composition root receives a drizzle handle from the host, builds the
 * write repository and read query adapters, and wires each use-case with the
 * deps it needs. Consumers call `module.<useCase>.execute(request)`; there is
 * no service facade.
 */
export interface __Entity__Module {
  readonly create__Entity__: Create__Entity__UseCase;
  readonly get__Entity__: Get__Entity__UseCase;
  readonly archive__Entity__: Archive__Entity__UseCase;
  readonly list__Entity__s: List__Entity__sUseCase;
  /** No-op: the host owns the connection. Kept for lifecycle symmetry. */
  close(): Promise<void>;
}

export interface __Entity__ModuleOptions {
  readonly db: Db;
}

/**
 * Assemble the module around a caller-provided drizzle handle. The host owns
 * the connection lifecycle; package tests build one via `openTestDb` in
 * `test/testing.ts`.
 */
export async function compose__Entity__Module(
  opts: __Entity__ModuleOptions,
): Promise<__Entity__Module> {
  const db = opts.db;
  const repo = new Drizzle__Entity__Repository({ db });
  const query = new Drizzle__Entity__Queries({ db });

  return {
    create__Entity__: new Create__Entity__UseCase({ repo }),
    get__Entity__: new Get__Entity__UseCase({ query }),
    archive__Entity__: new Archive__Entity__UseCase({ repo }),
    list__Entity__s: new List__Entity__sUseCase({ query }),
    async close() {
      // The host owns the connection; the module holds no handle to close.
    },
  };
}
