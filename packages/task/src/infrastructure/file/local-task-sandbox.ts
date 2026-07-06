import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { TaskArtifactFile } from "../../domain/task-artifact.js";
import type { TaskId } from "../../domain/task-id.js";
import type {
  ArtifactListingFailed,
  MaterializeWorkdirArgs,
  TaskSandbox,
  WorkdirFailed,
  WorkdirRemovalFailed,
} from "../../domain/task-sandbox.js";

/**
 * On-disk task layout contract. A task's workdir lives at
 * `<workspaceDir>/tasks/<taskId>/`; user-visible output goes under the
 * `artifact/` subdir. This sandbox materializes the layout; the task
 * module (to build the sandbox root) and the workflow worker runner
 * (to relativize a node's task artifacts) read the same contract from
 * these exports, so the layout has one source of truth.
 */
const TASKS_SUBDIR = "tasks";

/** The subdir under each task workdir holding user-visible output files. */
export const TASK_ARTIFACT_SUBDIR = "artifact";

/** Absolute root dir for a workspace's per-task workdirs (`<workspaceDir>/tasks`). */
export function tasksRoot(workspaceDir: string): string {
  return path.join(workspaceDir, TASKS_SUBDIR);
}

/**
 * On-disk task contract materialized into each workdir. The user's `brief` +
 * `details` live in `<workdir>/TASK.md` (never in the spawn argv — on Windows
 * `cmd.exe` treats an LF inside a `/c` payload as a statement separator, which
 * would truncate the CLI's flags); `temp/` is agent scratch and `artifact/`
 * holds user-visible output.
 */
const TASK_FILENAME = "TASK.md";
const TASK_TEMP_SUBDIR = "temp";

/**
 * Render the user-supplied `brief` (+ optional `details`) into the canonical
 * TASK.md byte sequence: `# <brief>\n` (brief-only) or
 * `# <brief>\n\n<details>\n`. `undefined` / `""` details collapse to
 * brief-only; the body always ends in exactly one trailing LF.
 */
function formatTaskMd(brief: string, details: string | undefined): string {
  if (details === undefined || details.length === 0) {
    return `# ${brief}\n`;
  }
  const trimmed = details.endsWith("\n") ? details : `${details}\n`;
  return `# ${brief}\n\n${trimmed}`;
}

/**
 * Local-filesystem adapter for {@link TaskSandbox}. Workdirs live at
 * `<root>/<id>/`; the branded task-id format (digits + hex, no path
 * separators) keeps the join under root without a separate traversal guard.
 *
 * `reserve` first ensures `<root>` exists (each package owns its own subdir
 * under the workspace dir; the workspace no longer pre-creates it), then
 * creates the per-id dir with `{recursive: false}` so a colliding id
 * surfaces as EEXIST.
 */
export class LocalTaskSandbox implements TaskSandbox {
  private readonly root: string;

  constructor(opts: { root: string }) {
    this.root = path.resolve(opts.root);
  }

  resolve(id: TaskId): string {
    return path.join(this.root, id);
  }

  reserve(id: TaskId): ResultAsync<string, WorkdirFailed> {
    const dir = this.resolve(id);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(this.root, { recursive: true });
        await mkdir(dir, { recursive: false });
        return dir;
      })(),
      (cause): WorkdirFailed => ({ type: "WorkdirFailed", phase: "reserve", cause }),
    );
  }

  materialize(args: MaterializeWorkdirArgs): ResultAsync<void, WorkdirFailed> {
    const { workdir, brief, details } = args;
    return ResultAsync.fromPromise(
      (async () => {
        await writeFile(path.join(workdir, TASK_FILENAME), formatTaskMd(brief, details), {
          encoding: "utf8",
        });
        await mkdir(path.join(workdir, TASK_TEMP_SUBDIR), { recursive: true });
        await mkdir(path.join(workdir, TASK_ARTIFACT_SUBDIR), { recursive: true });
      })(),
      (cause): WorkdirFailed => ({ type: "WorkdirFailed", phase: "materialize", cause }),
    );
  }

  listArtifacts(workdir: string): ResultAsync<readonly TaskArtifactFile[], ArtifactListingFailed> {
    const dir = path.join(workdir, TASK_ARTIFACT_SUBDIR);
    return ResultAsync.fromPromise(
      (async () => {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true, recursive: true });
        } catch (err) {
          // A not-yet-created artifact dir is the normal "no artifacts" case.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw err;
        }
        const files: TaskArtifactFile[] = [];
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const full = path.join(entry.parentPath, entry.name);
          try {
            const st = await stat(full);
            files.push({
              relPath: path.relative(dir, full).split(path.sep).join("/"),
              size: st.size,
              modifiedAt: st.mtime.toISOString(),
            });
          } catch {
            // Best-effort: skip files that vanish between readdir and stat.
          }
        }
        return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
      })(),
      (cause): ArtifactListingFailed => ({ type: "ArtifactListingFailed", cause }),
    );
  }

  resolveArtifactPath(id: TaskId, relPath: string): string | null {
    return safeJoinNested(path.join(this.resolve(id), TASK_ARTIFACT_SUBDIR), relPath);
  }

  remove(workdir: string): ResultAsync<void, WorkdirRemovalFailed> {
    return ResultAsync.fromPromise(
      rm(workdir, { recursive: true, force: true }),
      (cause): WorkdirRemovalFailed => ({ type: "WorkdirRemovalFailed", cause }),
    );
  }
}

/**
 * Join a POSIX `rel` path under `root`, refusing empty, `.`/`..`, NUL, or
 * any candidate that escapes `root`. Pure path math; returns `null` on any
 * refusal so callers surface a 404 rather than reaching outside the sandbox.
 */
function safeJoinNested(root: string, rel: string): string | null {
  if (rel === "" || rel.includes("\0")) return null;
  const segs = rel.split(/[\\/]/);
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || s.includes("\0")) return null;
  }
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, ...segs);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (!candidate.startsWith(rootWithSep) && candidate !== normalizedRoot) return null;
  return candidate;
}
