import { desc, eq } from "drizzle-orm";
import type { WorkspaceEntity } from "../domain/workspace.entity.js";
import { workspaces } from "./tables.js";
import type { Db } from "./workspace.db.js";

/**
 * Drizzle-backed workspace repository. Sync at the SQLite layer
 * (better-sqlite3 driver); methods are typed `Promise<...>` so the
 * async service signatures stay unchanged.
 *
 * Adapter boundary: public methods speak the domain `WorkspaceEntity`
 * (reads return it, `insert` accepts it); the Drizzle row/insert types
 * never cross this boundary. A workspace carries no behaviour, so the
 * row ↔ entity mapping is structural — `.get()`/`.all()` assign to the
 * entity directly and `.values(entity)` inserts directly, no explicit
 * `rowToEntity` helper. The service projects the entity to the wire
 * `Workspace` DTO via `projectWorkspace`, coalescing the nullable
 * `lastOpenedAt` to `createdAt` so consumers never see `null`.
 */
export class WorkspaceRepository {
  private readonly db: Db;

  constructor(opts: { db: Db }) {
    this.db = opts.db;
  }

  /**
   * ORDER BY chain shared by all "last opened" reads
   * (`findAllByLastOpened`, `findLastOpened`, `findLastOpenedId`).
   *
   * - `lastOpenedAt DESC` is the primary sort and matches what
   *   `getLastOpened` exposes.
   * - `createdAt DESC` is the secondary tiebreaker for ISO-8601-ms
   *   collisions (two registers landing in the same millisecond).
   * - `id ASC` is the final deterministic fallback.
   *
   * Tests that need "second register wins" insert a small `setTimeout`
   * between back-to-back registers to guarantee a strictly greater
   * `lastOpenedAt`, because identical millisecond stamps collapse to
   * id-ASC ordering — which returns the *first* registered id.
   */
  private static buildLastOpenedOrderBy() {
    return [desc(workspaces.lastOpenedAt), desc(workspaces.createdAt), workspaces.id];
  }

  async findById(id: string): Promise<WorkspaceEntity | undefined> {
    return this.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  }

  async findByPath(workspaceDir: string): Promise<WorkspaceEntity | undefined> {
    return this.db.select().from(workspaces).where(eq(workspaces.workspaceDir, workspaceDir)).get();
  }

  async findAllByLastOpened(): Promise<WorkspaceEntity[]> {
    return this.db
      .select()
      .from(workspaces)
      .orderBy(...WorkspaceRepository.buildLastOpenedOrderBy())
      .all();
  }

  async findLastOpened(): Promise<WorkspaceEntity | undefined> {
    return this.db
      .select()
      .from(workspaces)
      .orderBy(...WorkspaceRepository.buildLastOpenedOrderBy())
      .limit(1)
      .get();
  }

  async findLastOpenedId(): Promise<string | undefined> {
    const row = this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(...WorkspaceRepository.buildLastOpenedOrderBy())
      .limit(1)
      .get();
    return row?.id;
  }

  async insert(entity: WorkspaceEntity): Promise<void> {
    this.db.insert(workspaces).values(entity).run();
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkspaceEntity, "name" | "lastOpenedAt">>,
  ): Promise<void> {
    this.db.update(workspaces).set(patch).where(eq(workspaces.id, id)).run();
  }

  async delete(id: string): Promise<void> {
    this.db.delete(workspaces).where(eq(workspaces.id, id)).run();
  }
}
