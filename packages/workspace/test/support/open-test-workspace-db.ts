import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Db } from "../../src/infrastructure/drizzle/workspace-db.js";
import { applyWorkspaceMigrations } from "../../src/infrastructure/drizzle/workspace-migrations.js";

/**
 * Open an isolated workspace DB for tests. Each `createClient(":memory:")` is
 * its own in-memory database, so every call is fully isolated and needs no
 * file cleanup. (Migrations run via `batch(..., "write")`, which works on a
 * plain `:memory:` connection — see `applyWorkspaceMigrations`.)
 */
export async function openTestWorkspaceDb(): Promise<{ db: Db; close(): void }> {
  const client = createClient({ url: ":memory:" });
  await applyWorkspaceMigrations(client);
  const db = drizzle(client, { schema: {} }) as unknown as Db;
  return { db, close: () => client.close() };
}
