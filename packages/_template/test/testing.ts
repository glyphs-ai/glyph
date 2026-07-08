import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Db } from "../src/infrastructure/drizzle/__entity-kebab__-db.js";
import * as schema from "../src/infrastructure/drizzle/__entity-kebab__-db.js";
import { apply__Entity__Migrations } from "../src/infrastructure/drizzle/__entity-kebab__-migrations.js";

/**
 * Test-only DB opener. Applies PRAGMAs + migrations against a fresh
 * file-backed SQLite client via libsql. Production callers build their
 * client + drizzle handle in the host (see
 * `packages/api/src/workspace-context.ts`) and pass it to
 * `compose__Entity__Module({ db })`; production PRAGMAs are set once against
 * the shared client there.
 */
export async function openTestDb(dbFile: string): Promise<{ db: Db; close(): void }> {
  const url = dbFile === ":memory:" ? "file::memory:" : `file:${dbFile}`;
  const client = createClient({ url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await apply__Entity__Migrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
