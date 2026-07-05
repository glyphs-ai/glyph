/** One user-visible output file under a task's `artifact/` dir. */
export interface TaskArtifactFile {
  /** POSIX path relative to the task's `artifact/` dir (e.g. `ref/report.html`). */
  readonly relPath: string;
  readonly size: number;
  readonly modifiedAt: string;
}
