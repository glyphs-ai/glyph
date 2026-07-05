import { type Db, openWorkspaceDb } from "../../src/infrastructure/drizzle/workspace-db.js";

/**
 * Open an isolated workspace DB for tests. Each `createClient(":memory:")` is
 * its own in-memory database, so every call is fully isolated and needs no
 * file cleanup. (Migrations run via `batch(..., "write")`, which works on a
 * plain `:memory:` connection — see `applyWorkspaceMigrations`.)
 */
export async function openTestWorkspaceDb(): Promise<{ db: Db; close(): void }> {
  return openWorkspaceDb({ url: ":memory:" });
}
