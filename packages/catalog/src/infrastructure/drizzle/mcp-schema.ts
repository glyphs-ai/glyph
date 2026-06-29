/**
 * Drizzle table definition — the MCP persistence schema, owned by the
 * adapter. No domain or application code imports this file.
 *
 * One table fully describes an installed MCP: there is no file tree
 * (the spec is a single JSON blob stored inline) and no dependency
 * edges (MCPs are leaves). `fqn` is the spec FQN; `origin` is provenance.
 */

import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mcps = sqliteTable(
  "mcps",
  {
    fqn: text("fqn").primaryKey(),
    origin: text("origin").notNull(),
    spec: text("spec").notNull(),
    installedAt: text("installed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("mcps_origin").on(t.origin), index("mcps_updated_at").on(t.updatedAt)],
);
