import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persisted row for one `__Entity__`. Define exactly the columns this BC
 * owns; cross-BC relations are NOT modelled with foreign keys —
 * dependents look up by id through their own service.
 *
 * Exempt from the `<entity>.<role>.ts` dot-prefix file-naming rule:
 * `drizzle.config.ts` references this module by the literal path
 * `./src/persistence/tables.ts`, so the filename is a tooling contract.
 */
export const __entities__ = sqliteTable(
  "__entities__",
  {
    id: text("id").primaryKey(),
    // TODO: replace with the actual columns for this entity.
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("__entities___name_idx").on(t.name)],
);
