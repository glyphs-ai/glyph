import type { WorkflowArtifact } from "../../api";
import { fixtureWorkflowMockIds } from "./workflows";

/**
 * Designer-mode fixtures for the workflow Artifacts tab.
 *
 * Keyed by workflow id (`20260608-1f3a7b9c`, …) and laid out to
 * cover the four interesting list shapes:
 *
 *   - `20260608-1f3a7b9c`  workflow-summary entries (one self-
 *     contained HTML summary that auto-selects on mount,
 *     one md, and one png) + per-node entries for the task
 *     running in phase 3. The HTML entry exercises the
 *     `<iframe srcdoc>` viewer end-to-end so the C4 height-
 *     chain fix and the C5 summary-first auto-select effect
 *     are both visible in `pnpm dev:mock`.
 *   - `20260607-2e4b8cad`    per-node entries for both workers in
 *     phase 1; no curated workflow-summary content.
 *   - `20260606-3d5c9dbe`       — empty (`[]`), exercising the empty
 *     state in the Artifacts tab.
 *   - `20260605-4e6dabcf`     — workflow-summary entry only (the
 *     coordinator left a `summary.html` before cancel, per the
 *     D convention added in coordinator agent 0.1.2). Single
 *     entry auto-selects on mount so the C5 pin and the C4
 *     iframe height chain are both visible at a glance.
 *
 * Per-node `nodeId` + `taskId` values are pulled from the shared
 * `fixtureWorkflowMockIds` map exported by `workflows.ts` so the
 * Artifacts tab resolves against the same UUIDv4 / dated-hex ids
 * used by `WorkflowNode.id` / `WorkflowNode.taskId`. A
 * rename in `workflows.ts` propagates automatically.
 *
 * `modifiedAt` timestamps are inline-pinned for stable snapshots.
 */
const { nodes: N } = fixtureWorkflowMockIds;
const EPOCH = Date.parse("2026-05-28T00:00:00.000Z");
const iso = (offsetMinutes: number): string =>
  new Date(EPOCH + offsetMinutes * 60_000).toISOString();

export const fixtureWorkflowArtifacts: ReadonlyMap<string, readonly WorkflowArtifact[]> = new Map([
  [
    "20260608-1f3a7b9c",
    [
      {
        kind: "workflow-summary",
        relPath: "summary.html",
        size: 5_812,
        modifiedAt: iso(-60),
      },
      {
        kind: "workflow-summary",
        relPath: "report.md",
        size: 4123,
        modifiedAt: iso(-65),
      },
      {
        kind: "workflow-summary",
        relPath: "snapshots/phase-2-summary.png",
        size: 38_117,
        modifiedAt: iso(-70),
      },
      {
        kind: "node",
        nodeId: N.migTask1a,
        relPath: "diff-summary.md",
        size: 2410,
        modifiedAt: iso(-90),
      },
      {
        kind: "node",
        nodeId: N.migTask1a,
        relPath: "logs.txt",
        size: 18_990,
        modifiedAt: iso(-90),
      },
    ] as readonly WorkflowArtifact[],
  ],
  [
    "20260607-2e4b8cad",
    [
      {
        kind: "node",
        nodeId: N.logTask1a,
        relPath: "patch.md",
        size: 6321,
        modifiedAt: iso(-1330),
      },
      {
        kind: "node",
        nodeId: N.logTask1b,
        relPath: "test-output.json",
        size: 1011,
        modifiedAt: iso(-1325),
      },
    ] as readonly WorkflowArtifact[],
  ],
  ["20260606-3d5c9dbe", [] as readonly WorkflowArtifact[]],
  [
    "20260605-4e6dabcf",
    [
      {
        kind: "workflow-summary",
        relPath: "summary.html",
        size: 5_120,
        modifiedAt: iso(-4200),
      },
    ] as readonly WorkflowArtifact[],
  ],
]);
