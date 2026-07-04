import type { ResultAsync } from "neverthrow";
import type { TaskArtifactFile } from "./task-artifact.js";
import type { TaskId } from "./task-id.js";

/** `reserve`: the exclusive `mkdir` for a task workdir faulted (EEXIST id collision, missing parent, …). */
export type WorkdirReservationFailed = {
  readonly type: "WorkdirReservationFailed";
  readonly cause: unknown;
};

/** `materialize`: writing `TASK.md` or creating the `temp/` / `artifact/` subdirs faulted. */
export type WorkdirMaterializationFailed = {
  readonly type: "WorkdirMaterializationFailed";
  readonly cause: unknown;
};

/** `listArtifacts`: reading the `artifact/` directory faulted (other than "not present"). */
export type ArtifactListingFailed = {
  readonly type: "ArtifactListingFailed";
  readonly cause: unknown;
};

/** `remove`: recursively removing a task workdir faulted. */
export type WorkdirRemovalFailed = {
  readonly type: "WorkdirRemovalFailed";
  readonly cause: unknown;
};

/** Inputs to {@link TaskSandbox.materialize}. */
export interface MaterializeWorkdirArgs {
  readonly workdir: string;
  readonly brief: string;
  readonly details: string | undefined;
}

/**
 * Filesystem port owning a task's on-disk sandbox (its workdir) lifecycle.
 * Each task is one directory under `<workspaceDir>/tasks/<id>/`. The branded
 * {@link TaskId} format (digits + hex, no path separators) guarantees the
 * join stays under root, so no separate traversal guard is needed.
 *
 * Satisfied at the composition root by the local-filesystem adapter
 * (`LocalTaskSandbox`); tests inject a fake. Reservation (exclusive
 * `mkdir`) is the id-uniqueness gate and happens before the row is
 * persisted; materialization writes `TASK.md` + the `temp/` / `artifact/`
 * subdirs after.
 */
export interface TaskSandbox {
  /** Absolute workdir path for `id`. Pure; performs no I/O. */
  resolve(id: TaskId): string;

  /** Exclusively create the workdir (fails if it already exists); returns its path. */
  reserve(id: TaskId): ResultAsync<string, WorkdirReservationFailed>;

  /** Write `TASK.md` from `brief` + `details` and create the `temp/` / `artifact/` subdirs. */
  materialize(args: MaterializeWorkdirArgs): ResultAsync<void, WorkdirMaterializationFailed>;

  /**
   * Every regular file under `<workdir>/artifact/` (recursively, at any
   * depth) as a {@link TaskArtifactFile} (POSIX relPath + size + mtime),
   * sorted by relPath. Resolves to `[]` when the directory is absent; a
   * genuine read fault surfaces `ArtifactListingFailed`.
   */
  listArtifacts(workdir: string): ResultAsync<readonly TaskArtifactFile[], ArtifactListingFailed>;

  /**
   * Join a whitelisted `relPath` under `id`'s `artifact/` root to its
   * absolute fs path; `null` if `relPath` is malformed or escapes the root.
   * Pure path math (no I/O).
   */
  resolveArtifactPath(id: TaskId, relPath: string): string | null;

  /** Recursively remove the workdir (force). */
  remove(workdir: string): ResultAsync<void, WorkdirRemovalFailed>;
}
