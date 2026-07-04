import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { SessionId } from "../../domain/session-id.js";
import type {
  SandboxProvisionFailed,
  SandboxRemovalFailed,
  SessionSandbox,
} from "../../domain/session-sandbox.js";

const SESSIONS_SUBDIR = "sessions";

/** Absolute root dir for a workspace's per-session sandboxes. */
export function sessionsRoot(workspaceDir: string): string {
  return path.join(workspaceDir, SESSIONS_SUBDIR);
}

/**
 * Local-filesystem adapter for {@link SessionSandbox}. Sandboxes live at
 * `<root>/<id>/`; the branded session-id format (digits + hex, no path
 * separators) guarantees the join stays under root, so no separate
 * traversal guard is needed.
 */
export class LocalSessionSandbox implements SessionSandbox {
  private readonly root: string;

  constructor(opts: { root: string }) {
    this.root = path.resolve(opts.root);
  }

  resolve(id: SessionId): string {
    return path.join(this.root, id);
  }

  create(id: SessionId): ResultAsync<string, SandboxProvisionFailed> {
    const dir = this.resolve(id);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(this.root, { recursive: true });
        await mkdir(dir, { recursive: false });
        return dir;
      })(),
      (cause): SandboxProvisionFailed => ({ type: "SandboxProvisionFailed", cause }),
    );
  }

  remove(id: SessionId): ResultAsync<void, SandboxRemovalFailed> {
    const dir = this.resolve(id);
    return ResultAsync.fromPromise(
      rm(dir, { recursive: true, force: true }),
      (cause): SandboxRemovalFailed => ({ type: "SandboxRemovalFailed", cause }),
    );
  }
}
