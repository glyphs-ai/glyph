import { and, eq, like } from "drizzle-orm";
import type { __Entity__Entity } from "../domain/__entity-kebab__.entity.js";
import type { Db } from "./__entity-kebab__.db.js";
import { __entities__ } from "./tables.js";

/**
 * Drizzle-backed CRUD for the `__entities__` table. Private to the pkg:
 * external callers go through `__Entity__Service`. Sync at the SQLite
 * layer (better-sqlite3 driver); methods are typed `Promise<...>` so the
 * async service signatures stay unchanged.
 *
 * **Adapter boundary:** public methods speak the domain
 * {@link __Entity__Entity} — reads return it, `insert` accepts it; the
 * Drizzle row/insert types never cross this boundary. This BC is anemic,
 * so the row ↔ entity mapping is structural: `.get()`/`.all()` assign to
 * the entity directly and `.values(entity)` inserts directly, no
 * explicit `rowToEntity`. When the entity becomes a `class` (behaviour
 * appears), add `rowToEntity` / `entityToRowFields` projections here; the
 * public signatures stay the same.
 *
 * Input validation is NOT here — the service validates ids / inputs with
 * the zod schemas in `contract/__entity-kebab__.schemas.ts` before
 * calling the repository. See `docs/pkg-template.md` "Repository
 * contract".
 */
export class __Entity__Repository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  async findById(id: string): Promise<__Entity__Entity | undefined> {
    return this.db.select().from(__entities__).where(eq(__entities__.id, id)).get();
  }

  async insert(entity: __Entity__Entity): Promise<void> {
    this.db.insert(__entities__).values(entity).run();
  }

  /** Idempotent: deleting a missing row is a no-op at the SQL layer. */
  async delete(id: string): Promise<void> {
    this.db.delete(__entities__).where(eq(__entities__.id, id)).run();
  }

  async findAll(opts: { nameStartsWith?: string } = {}): Promise<__Entity__Entity[]> {
    const where =
      opts.nameStartsWith !== undefined
        ? like(__entities__.name, `${opts.nameStartsWith}%`)
        : undefined;
    const q = this.db.select().from(__entities__);
    return where !== undefined ? q.where(and(where)).all() : q.all();
  }
}
