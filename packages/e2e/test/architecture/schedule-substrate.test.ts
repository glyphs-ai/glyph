/**
 * Pin the cross-package "schedule substrate" -- the implicit string
 * contract by which a fired schedule becomes a task/workflow that can
 * later be found and cleaned up.
 *
 * Three magic tokens must agree across four packages:
 *
 *   - the origin tag    `"schedule"`     (api producers, task/workflow
 *                                          repositories, partial indexes)
 *   - the metadata key  `scheduleId`     (api producers stamp it; repos
 *                                          + indexes query it)
 *   - the JSON path     `'$.scheduleId'` (repositories + indexes)
 *
 * Flow: `schedule-service.dispatch()` hands the registered handler an
 * envelope `{ scheduleId: entity.id, ... }`; the api wiring handlers
 * create the task/workflow with `origin: "schedule"` and
 * `metadata: { scheduleId }`; the task/workflow repositories locate that
 * work with `json_extract(metadata, '$.scheduleId')` filtered to
 * `origin = 'schedule'`, backed by a partial index on the same
 * expression. No single test pins that all of those ends agree, so a
 * rename on one side silently breaks in-flight dedup + schedule cleanup
 * (the producer writes a key the consumer never queries). This audit
 * reads the sources and fails if the substrate drifts.
 *
 * It deliberately reads source text rather than exercising a live DB:
 * the failure mode is a literal-string divergence between packages that
 * each still type-check in isolation, which a source-level pin catches
 * directly and cheaply.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

function readSrc(rel: string): string {
  return readFileSync(path.join(PACKAGES_DIR, rel), "utf8");
}

// The JSON path the repositories + indexes extract the schedule id from.
const SCHEDULE_ID_JSON_PATH = /'\$\.scheduleId'/;
// `origin = 'schedule'` in raw SQL (column optionally backtick-quoted).
const ORIGIN_SCHEDULE_SQL = /`?origin`?\s*=\s*'schedule'/;

describe("schedule substrate: producer envelope", () => {
  it("schedule-service hands the handler { scheduleId: entity.id }", () => {
    const src = readSrc("schedule/src/schedule-service.ts");
    expect(src).toMatch(/scheduleId:\s*entity\.id/);
  });
});

describe("schedule substrate: api handlers stamp origin + metadata.scheduleId", () => {
  for (const rel of [
    "api/src/wiring/schedule-task-handler.ts",
    "api/src/wiring/schedule-workflow-handler.ts",
  ] as const) {
    it(`${path.basename(rel)} creates work with origin "schedule" + metadata.scheduleId`, () => {
      const src = readSrc(rel);
      expect(src, rel).toMatch(/origin:\s*"schedule"/);
      expect(src, rel).toMatch(/metadata:\s*\{\s*scheduleId/);
    });
  }
});

describe("schedule substrate: repositories query the stamped metadata", () => {
  it("task-repository resolves scheduled work via json_extract '$.scheduleId'", () => {
    const src = readSrc("task/src/task-repository.ts");
    expect(src).toMatch(/json_extract/);
    expect(src).toMatch(SCHEDULE_ID_JSON_PATH);
    expect(src).toMatch(/"scheduleId"/);
  });

  it('workflow-repository pairs origin "schedule" with metadataKey "scheduleId"', () => {
    const src = readSrc("workflow/src/workflow-repository.ts");
    expect(src).toMatch(/json_extract/);
    expect(src).toMatch(SCHEDULE_ID_JSON_PATH);
    expect(src).toMatch(/origin:\s*"schedule"/);
    expect(src).toMatch(/metadataKey:\s*"scheduleId"/);
  });
});

describe("schedule substrate: partial indexes match the query", () => {
  for (const [pkg, rel] of [
    ["task", "task/src/migrations.ts"],
    ["workflow", "workflow/src/migrations.ts"],
  ] as const) {
    it(`${pkg} partial index is scoped to origin='schedule' on '$.scheduleId'`, () => {
      const src = readSrc(rel);
      expect(src, rel).toMatch(/json_extract/);
      expect(src, rel).toMatch(SCHEDULE_ID_JSON_PATH);
      expect(src, rel).toMatch(ORIGIN_SCHEDULE_SQL);
    });
  }
});
