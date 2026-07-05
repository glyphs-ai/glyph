import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../src/infrastructure/drizzle/__entity-kebab__-migrations.js";

/** Drift guard: one inlined migration per `drizzle/*.sql` file. */
describe("migrations", () => {
  const onDiskCount = readdirSync(join(import.meta.dirname, "..", "..", "..", "drizzle")).filter(
    (f) => f.endsWith(".sql"),
  ).length;

  it("MIGRATIONS has one entry per drizzle/*.sql file", () => {
    expect(MIGRATIONS.length).toBe(onDiskCount);
  });

  it("every migration has non-empty SQL + a hash", () => {
    for (const m of MIGRATIONS) {
      expect(m.sql.some((stmt) => stmt.trim().length > 0)).toBe(true);
      expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
