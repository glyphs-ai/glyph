import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkflowArtifact, WorkflowArtifactsResponse } from "@glyphs-ai/api";
import {
  tasksRoot as resolveTasksRoot,
  safeJoinUnderRoot as safeJoinTaskRoot,
  TASK_ARTIFACT_SUBDIR,
  type TaskService,
} from "@glyphs-ai/task";
import { workflowDir as resolveWorkflowDir, type WorkflowService } from "@glyphs-ai/workflow";
import type { Context } from "hono";
import { contentTypeFor, mimeBucketFor } from "../../util/mime-bucket.js";
import { safeJoinNested } from "../../util/safe-join.js";
import { streamFileAsResponse } from "../../util/stream-file.js";
import { workflowsErrorPolicy } from "../_error-policies/workflows.js";
import { respondError } from "../_respond-error.js";

export interface ArtifactRouteDeps {
  readonly resolve: (c: Context) => WorkflowService;
  readonly resolveTasks: (c: Context) => TaskService;
  readonly resolveWorkspaceDir: (c: Context) => string;
}

// ── GET /:wfid/artifacts — list workflow + per-node artifacts ────
//
// Aggregates two on-disk namespaces:
//   1. `<workflowDir>/artifact/` — files the coordinator curated as
//      workflow-summary artifacts. May not exist (returns []).
//   2. `<tasksRoot>/<taskId>/artifact/` — per-node task artifacts.
//      Resolved via the substrate enrichment (taskId reverse-lookup).
//
// Workflow-summary entries come first; node groups follow, sorted
// by `nodeId` for stability across polls. A workflow with no
// artifacts in either namespace returns `{ artifacts: [] }` (200);
// a missing workflow returns 404.
export async function handleListArtifacts(
  c: Context,
  wfid: string,
  deps: ArtifactRouteDeps,
): Promise<Response> {
  const { resolve, resolveTasks, resolveWorkspaceDir } = deps;
  let snapshot: Awaited<ReturnType<WorkflowService["getDag"]>>;
  try {
    snapshot = await resolve(c).getDag(wfid);
  } catch (err) {
    return respondError(c, err, {
      route: "workflows.artifacts.list",
      policy: workflowsErrorPolicy,
      meta: { workflowId: wfid },
    });
  }

  const workspaceDir = resolveWorkspaceDir(c);
  const tasksSvc = resolveTasks(c);

  const summaryRoot = path.join(resolveWorkflowDir(workspaceDir, wfid), "artifact");
  const summaryFiles = await listFilesRecursive(summaryRoot);
  const summaryEntries: WorkflowArtifact[] = summaryFiles.map((f) => ({
    kind: "workflow-summary" as const,
    path: f.relPath,
    size: f.size,
    modifiedAt: f.modifiedAt,
    mimeBucket: mimeBucketFor(f.relPath),
  }));

  // Node groups: every node (worker AND coord) that resolves to a
  // dispatched task. We surface coord tasks too — the dashboard's
  // Mode B drill-down navigates to either kind uniformly.
  const nodes = [...snapshot.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const tasksRoot = resolveTasksRoot(workspaceDir);
  const nodeEntries: WorkflowArtifact[] = [];
  for (const node of nodes) {
    const task = await tasksSvc.findTaskByWorkflowNode(node.id);
    if (task === null) continue;
    let taskDir: string;
    try {
      taskDir = safeJoinTaskRoot(tasksRoot, task.id);
    } catch {
      continue;
    }
    const artifactRoot = path.join(taskDir, TASK_ARTIFACT_SUBDIR);
    const files = await listFilesRecursive(artifactRoot);
    for (const f of files) {
      nodeEntries.push({
        kind: "node" as const,
        nodeId: node.id,
        taskId: task.id,
        path: f.relPath,
        size: f.size,
        modifiedAt: f.modifiedAt,
        mimeBucket: mimeBucketFor(f.relPath),
      });
    }
  }

  const response: WorkflowArtifactsResponse = {
    artifacts: [...summaryEntries, ...nodeEntries],
  };
  return c.json(response);
}

// ── GET /:wfid/artifacts/:encodedPath — stream one artifact ──────
//
// `encodedPath` is a SINGLE Hono path segment, so multi-segment
// paths like `summary/foo/bar.md` need to be encoded with `%2F`
// for `/` on the wire. The route decodes once, branches on
// sentinel prefix, then path-traverses-checks via
// `safeJoinNested` before serving bytes.
//
//   - `summary/<rest>` → `<workflowDir>/artifact/<rest>` (no-store)
//   - `nodes/<nodeId>/<rest>` → `<tasksRoot>/<taskId>/artifact/<rest>`
//     (`max-age=300` once owning task is terminal; `no-store` while
//     it is still running, since the worker may still be appending)
//
// Any other prefix yields 400.
export async function handleStreamArtifact(
  c: Context,
  wfid: string,
  encoded: string,
  deps: ArtifactRouteDeps,
): Promise<Response> {
  const { resolveTasks, resolveWorkspaceDir } = deps;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return c.json({ error: "encodedPath is not a valid percent-encoded string" }, 400);
  }

  // Cheap up-front traversal rejection. The per-segment
  // `safeJoinNested` below is still the canonical defence, but
  // failing the obvious cases here keeps the error body
  // descriptive ("traversal in path" vs the generic "escapes root").
  if (decoded.includes("..") || decoded.includes("\0")) {
    return c.json({ error: "traversal segment in artifact path" }, 400);
  }

  const workspaceDir = resolveWorkspaceDir(c);
  let absPath: string;
  let cacheControl: string;

  if (decoded.startsWith("summary/")) {
    const rest = decoded.slice("summary/".length);
    if (rest === "" || rest.startsWith("/")) {
      return c.json({ error: "summary path missing trailing segments" }, 400);
    }
    try {
      const summaryRoot = path.join(resolveWorkflowDir(workspaceDir, wfid), "artifact");
      absPath = safeJoinNested(summaryRoot, rest);
    } catch {
      return c.json({ error: "artifact path escapes workflow root" }, 400);
    }
    cacheControl = "no-store";
  } else if (decoded.startsWith("nodes/")) {
    // `nodes/<nodeId>/<rest>` — minimum two slashes inside.
    const tail = decoded.slice("nodes/".length);
    const sep = tail.indexOf("/");
    if (sep <= 0 || sep === tail.length - 1) {
      return c.json({ error: "nodes path must be nodes/<nodeId>/<rest>" }, 400);
    }
    const nodeId = tail.slice(0, sep);
    const rest = tail.slice(sep + 1);
    const task = await resolveTasks(c).findTaskByWorkflowNode(nodeId);
    if (task === null) {
      return c.json({ error: "no task dispatched for node" }, 404);
    }
    try {
      const tasksRoot = resolveTasksRoot(workspaceDir);
      const taskDir = safeJoinTaskRoot(tasksRoot, task.id);
      const artifactRoot = path.join(taskDir, TASK_ARTIFACT_SUBDIR);
      absPath = safeJoinNested(artifactRoot, rest);
    } catch {
      return c.json({ error: "artifact path escapes task root" }, 400);
    }
    // Per-node artifact bytes are only write-once AFTER the owning
    // task reaches a terminal status (the worker may still be
    // appending to a file while it runs). Cache aggressively once
    // terminal; force a re-fetch on every read while running.
    const taskTerminal =
      task.status === "succeeded" || task.status === "failed" || task.status === "cancelled";
    cacheControl = taskTerminal ? "max-age=300" : "no-store";
  } else {
    return c.json({ error: "artifact path must start with summary/ or nodes/<nid>/" }, 400);
  }

  try {
    const st = await stat(absPath);
    if (!st.isFile()) {
      return c.json({ error: "artifact not found" }, 404);
    }
  } catch {
    return c.json({ error: "artifact not found" }, 404);
  }

  return streamFileAsResponse(absPath, {
    contentType: contentTypeFor(path.basename(absPath)),
    cacheControl,
  });
}

/**
 * Recursive directory walk. Returns one entry per regular file
 * under `root` with the path relative to `root` (forward slashes,
 * cross-platform), size, and ISO mtime. Returns `[]` when `root`
 * doesn't exist or is unreadable — the caller treats "no curated
 * artifacts yet" as the steady-state for a fresh workflow rather
 * than a 500.
 *
 * Per-file errors are warn-skipped: a transient `stat` fault on one
 * entry doesn't poison the whole listing. (Mirrors the
 * warn-and-skip pattern in `TaskRepository.list`.)
 */
async function listFilesRecursive(root: string): Promise<readonly FileEntry[]> {
  const out: FileEntry[] = [];
  await walk(root, "");
  return out;

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Missing or unreadable. For the root dir this is the
      // "no artifacts yet" case; for a nested dir we just skip.
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full, childRel);
      } else if (entry.isFile()) {
        try {
          const st = await stat(full);
          out.push({
            relPath: childRel,
            size: st.size,
            modifiedAt: st.mtime.toISOString(),
          });
        } catch {
          // Best-effort: skip files that disappear between readdir
          // and stat.
        }
      }
    }
  }
}

interface FileEntry {
  readonly relPath: string;
  readonly size: number;
  readonly modifiedAt: string;
}
