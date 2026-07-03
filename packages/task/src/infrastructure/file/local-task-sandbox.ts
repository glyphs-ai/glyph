import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { TaskId } from "../../domain/task-id.js";
import type {
  ArtifactListingFailed,
  MaterializeWorkdirArgs,
  TaskSandbox,
  WorkdirMaterializationFailed,
  WorkdirRemovalFailed,
  WorkdirReservationFailed,
} from "../../domain/task-sandbox.js";
import { TASK_ARTIFACT_SUBDIR } from "../../task-paths.js";

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
 * `reserve` uses `{recursive: false}` so a missing `<root>` surfaces as a
 * composition bug (the root is pre-created by the workspace provisioner)
 * rather than silently self-healing, and a colliding id surfaces as EEXIST.
 */
export class LocalTaskSandbox implements TaskSandbox {
  private readonly root: string;

  constructor(opts: { root: string }) {
    this.root = path.resolve(opts.root);
  }

  resolve(id: TaskId): string {
    return path.join(this.root, id);
  }

  reserve(id: TaskId): ResultAsync<string, WorkdirReservationFailed> {
    const dir = this.resolve(id);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(dir, { recursive: false });
        return dir;
      })(),
      (cause): WorkdirReservationFailed => ({ type: "WorkdirReservationFailed", cause }),
    );
  }

  materialize(args: MaterializeWorkdirArgs): ResultAsync<void, WorkdirMaterializationFailed> {
    const { workdir, brief, details } = args;
    return ResultAsync.fromPromise(
      (async () => {
        await writeFile(path.join(workdir, TASK_FILENAME), formatTaskMd(brief, details), {
          encoding: "utf8",
        });
        await mkdir(path.join(workdir, TASK_TEMP_SUBDIR), { recursive: true });
        await mkdir(path.join(workdir, TASK_ARTIFACT_SUBDIR), { recursive: true });
      })(),
      (cause): WorkdirMaterializationFailed => ({ type: "WorkdirMaterializationFailed", cause }),
    );
  }

  listArtifacts(workdir: string): ResultAsync<readonly string[], ArtifactListingFailed> {
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
        return entries
          .filter((e) => e.isFile())
          .map((e) => path.join(e.parentPath, e.name))
          .sort((a, b) => a.localeCompare(b));
      })(),
      (cause): ArtifactListingFailed => ({ type: "ArtifactListingFailed", cause }),
    );
  }

  remove(workdir: string): ResultAsync<void, WorkdirRemovalFailed> {
    return ResultAsync.fromPromise(
      rm(workdir, { recursive: true, force: true }),
      (cause): WorkdirRemovalFailed => ({ type: "WorkdirRemovalFailed", cause }),
    );
  }
}
