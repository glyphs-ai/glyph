import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { applyWorkspaceMigrations } from "./workspace-migrations.js";
import * as schema from "./workspace-schema.js";

/** The pkg's drizzle DB handle, parameterized by the workspace tables. */
export type Db = LibSQLDatabase<typeof schema>;

/**
 * Open a workspace DB (libsql) at `url`, set WAL pragmas, apply migrations,
 * and return the drizzle handle plus `close`. The caller decides the `url`
 * (a `file:` URL for a real path, chosen by the assembler) — this package
 * owns the schema + migrations, never the file-path/`:memory:` policy. The
 * returned handle is not closed by the workspace module; whoever opened it
 * owns `close`.
 */
export async function openWorkspaceDb(opts: { url: string }): Promise<{ db: Db; close(): void }> {
  const client: Client = createClient({ url: opts.url });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  // No foreign-key constraints exist in this schema.
  await client.execute("PRAGMA busy_timeout = 5000");
  try {
    await applyWorkspaceMigrations(client);
  } catch (err) {
    client.close();
    throw err;
  }
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
