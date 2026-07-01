/**
 * Pin the cross-package "schedule substrate" -- the contract by which a
 * fired schedule becomes a task/workflow that can later be found and
 * cleaned up. The schedule id is a first-class typed column
 * (`origin_id`), NOT a `metadata` JSON probe.
 *
 * The tokens that must agree across packages:
 *
 *   - the origin tag    `"schedule"`   (api producers stamp it; the
 *                                        migration partial index scopes on
 *                                        it; the repositories pair it with
 *                                        the id column)
 *   - the typed column  `origin_id`    (api producers stamp
 *                                        `originId: scheduleId`; the
 *                                        repositories query
 *                                        `eq(*.originId, …)`; a composite
 *                                        partial index `(origin, origin_id)`
 *                                        backs the lookup)
 *
 * Flow: `schedule-service.dispatch()` hands the registered handler an
 * envelope `{ scheduleId: entity.id, … }`; the api wiring handlers create
 * the task/workflow with `origin: "schedule"` and `originId: scheduleId`;
 * the task/workflow repositories locate that work by the typed
 * `(origin, origin_id)` column pair, backed by a composite partial index
 * on the same columns. No single test pins that all of those ends agree,
 * so a drift on one side silently breaks in-flight dedup + schedule
 * cleanup (the producer writes a column the consumer never queries). This
 * audit reads the sources and fails if the substrate drifts.
 *
 * It also pins the *negative*: the repositories MUST NOT recover the
 * schedule id by probing `metadata` via `json_extract('$.scheduleId')`.
 * Only the backfill migration may reference the metadata scheduleId
 * path; hot-path repositories must use `origin_id`.
 *
 * It deliberately reads source text rather than exercising a live DB: the
 * failure mode is a literal divergence between packages that each still
 * type-check in isolation, which a source-level pin catches directly and
 * cheaply.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

function readSrc(rel: string): string {
  return readFileSync(path.join(PACKAGES_DIR, rel), "utf8");
}

// Metadata scheduleId path permitted only in the backfill migration; hot-path
// repositories must use the typed `origin_id` column.
const LEGACY_SCHEDULE_ID_JSON_PATH = /'\$\.scheduleId'/;
// The composite partial index that backs the typed `(origin, origin_id)`
// lookup -- column order and partial predicate both pinned.
const ORIGIN_PAIR_INDEX =
  /CREATE INDEX [`"]?\w*origin_pair\w*[`"]?\s+ON\s+[`"]?\w+[`"]?\s*\(\s*[`"]?origin[`"]?\s*,\s*[`"]?origin_id[`"]?\s*\)\s*WHERE\s+[`"]?origin_id[`"]?\s+IS\s+NOT\s+NULL/i;
// Dropped schedule-id index permitted only in the backfill migration; hot-path
// repositories must use the typed `origin_id` column.
const LEGACY_SCHEDULE_ID_INDEX_DROP = /DROP INDEX IF EXISTS [`"]?\w*schedule_id_idx[`"]?/i;

describe("schedule substrate: producer envelope", () => {
  it("schedule-service hands the handler { scheduleId: entity.id }", () => {
    const src = readSrc("schedule/src/schedule-service.ts");
    expect(src).toMatch(/scheduleId:\s*entity\.id/);
  });
});

describe("schedule substrate: api handlers stamp origin + typed origin_id", () => {
  for (const rel of [
    "api/src/wiring/schedule-task-handler.ts",
    "api/src/wiring/schedule-workflow-handler.ts",
  ] as const) {
    it(`${path.basename(rel)} creates work with origin "schedule" + originId: scheduleId`, () => {
      const src = readSrc(rel);
      expect(src, rel).toMatch(/origin:\s*"schedule"/);
      expect(src, rel).toMatch(/originId:\s*scheduleId/);
    });
  }
});

describe("schedule substrate: repositories query the typed origin_id column", () => {
  it("task-repository locates scheduled work via the (origin, origin_id) columns", () => {
    const src = readSrc("task/src/infrastructure/drizzle/task-repository.ts");
    expect(src).toMatch(/eq\(\s*tasks\.origin\s*,/);
    expect(src).toMatch(/eq\(\s*tasks\.originId\s*,/);
    // Negative: the schedule id is never recovered from a metadata JSON probe.
    expect(src).not.toMatch(LEGACY_SCHEDULE_ID_JSON_PATH);
  });

  it("workflow-repository locates scheduled work via the (origin, origin_id) columns", () => {
    const src = readSrc("workflow/src/workflow-repository.ts");
    expect(src).toMatch(/eq\(\s*workflows\.origin\s*,/);
    expect(src).toMatch(/(?:eq|inArray)\(\s*workflows\.originId\s*,/);
    expect(src).not.toMatch(LEGACY_SCHEDULE_ID_JSON_PATH);
  });
});

describe("schedule substrate: composite partial index backs the column query", () => {
  for (const [pkg, rel] of [
    ["task", "task/src/infrastructure/drizzle/task-migrations.ts"],
    ["workflow", "workflow/src/migrations.ts"],
  ] as const) {
    it(`${pkg} migration creates the (origin, origin_id) partial index`, () => {
      const src = readSrc(rel);
      expect(src, rel).toMatch(ORIGIN_PAIR_INDEX);
    });
    it(`${pkg} migration drops the legacy single-column schedule-id index`, () => {
      const src = readSrc(rel);
      expect(src, rel).toMatch(LEGACY_SCHEDULE_ID_INDEX_DROP);
    });
  }
});
