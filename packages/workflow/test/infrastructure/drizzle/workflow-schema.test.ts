import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../testing.js";

async function removeDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error;
    if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
  }
}

/**
 * Schema smoke test. Verifies the migration set produces the three workflow
 * tables (`workflows`, `workflow_nodes`, `workflow_edges`) with the expected
 * columns, NOT NULL / DEFAULT shape, and indexes. Drives the schema via the
 * migration runner so a future migration that drifts the table shape is caught
 * here, not at the first production deploy. Raw SQLite introspection uses a
 * separate libsql connection opened on the migrated file.
 */

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "wf-schema-"));
  const dbFile = join(dir, "workspace.db");
  const { close } = await openTestDb(dbFile);
  close();
  client = createClient({ url: `file:${dbFile}` });
});

afterEach(async () => {
  client.close();
  await removeDir(dir);
});

describe("workflows schema", () => {
  it("creates workflows, workflow_nodes, workflow_edges tables", async () => {
    const rows = (
      await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    ).rows as unknown as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("workflows");
    expect(names).toContain("workflow_nodes");
    expect(names).toContain("workflow_edges");
  });

  it("workflows table has the expected column set", async () => {
    const cols = (await client.execute("PRAGMA table_info('workflows')")).rows as unknown as {
      name: string;
      notnull: number;
    }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "brief",
        "cancellation",
        "coordinator_agent",
        "created_at",
        "details",
        "ended_at",
        "failure",
        "id",
        "metadata",
        "origin",
        "origin_id",
        "started_at",
        "status",
        "success",
      ].sort(),
    );
    // `coordinator_agent` is the denorm cache of the current coord node's agent
    // FQN; it must be NOT NULL so "who's running this workflow?" is always
    // answerable with a single-row read.
    const coordCol = cols.find((c) => c.name === "coordinator_agent");
    expect(coordCol?.notnull).toBe(1);
    // Terminal payload columns are nullable at the table layer because only the
    // payload matching the current terminal status is set; the entity layer
    // enforces the cross-field requirement.
    for (const name of ["success", "failure", "cancellation"]) {
      const col = cols.find((c) => c.name === name);
      expect(col?.notnull, `${name} should be nullable`).toBe(0);
    }
  });

  it("workflow_nodes table has the expected column set", async () => {
    const cols = (await client.execute("PRAGMA table_info('workflow_nodes')")).rows as unknown as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "created_at",
        "ended_at",
        "id",
        "kind",
        "metadata",
        "phase",
        "ready_at",
        "running_at",
        "spec_json",
        "status",
        "workflow_id",
      ].sort(),
    );
    // `kind` and `spec_json` deliberately have no DEFAULT: every INSERT must
    // spell them out so the kind-handler registration story stays honest (no
    // silent "default kind").
    const kind = cols.find((c) => c.name === "kind");
    const spec = cols.find((c) => c.name === "spec_json");
    expect(kind?.notnull).toBe(1);
    expect(kind?.dflt_value).toBeNull();
    expect(spec?.notnull).toBe(1);
    expect(spec?.dflt_value).toBeNull();
    // `phase` is the node's topological depth, stored as INTEGER NN so SQL
    // ORDER BY phase yields the natural rendering order.
    const phase = cols.find((c) => c.name === "phase");
    expect(phase?.notnull).toBe(1);
    expect(phase?.type.toUpperCase()).toBe("INTEGER");
  });

  it("workflow_edges table has the expected column set + composite PK", async () => {
    const cols = (await client.execute("PRAGMA table_info('workflow_edges')")).rows as unknown as {
      name: string;
      pk: number;
    }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["from_node_id", "to_node_id", "workflow_id"].sort());
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols.sort()).toEqual(["from_node_id", "to_node_id", "workflow_id"].sort());
  });

  it("creates the indexes the substrate read patterns rely on", async () => {
    const rows = (
      await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
    ).rows as unknown as { name: string }[];
    const names = rows.map((r) => r.name);
    // Workflow listings filter on status; admin lookup filters on
    // coordinator_agent.
    expect(names).toContain("workflows_status_idx");
    expect(names).toContain("workflows_coordinator_agent_idx");
    // Per-workflow scans + status-filtered scans.
    expect(names).toContain("workflow_nodes_workflow_idx");
    expect(names).toContain("workflow_nodes_status_idx");
    expect(names).not.toContain("workflow_nodes_phase_idx");
    // Edge lookups in both directions for the readiness check.
    expect(names).toContain("workflow_edges_from_idx");
    expect(names).toContain("workflow_edges_to_idx");
  });

  it("uses the per-pkg journal table __drizzle_migrations_workflow", async () => {
    const rows = (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__drizzle%'",
      )
    ).rows as unknown as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("__drizzle_migrations_workflow");
  });
});
