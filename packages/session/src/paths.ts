import path from "node:path";
import { SessionPathEscapeError } from "./errors.js";

/** Subdirectory under `<workspaceDir>/` where per-session workdirs live. */
const SESSIONS_SUBDIR = "sessions";

/** Resolve the absolute root directory for this workspace's session workdirs. */
export function sessionsRoot(workspaceDir: string): string {
  return path.join(workspaceDir, SESSIONS_SUBDIR);
}

/**
 * Path-traversal defense. Given a validated id (caller has already run
 * assertValidSessionId), construct the workdir path and assert it is a child
 * of root. Throws {@link SessionPathEscapeError} if not.
 */
export function safeJoinUnderRoot(root: string, id: string): string {
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, id);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (!candidate.startsWith(rootWithSep) && candidate !== normalizedRoot) {
    throw new SessionPathEscapeError(candidate, rootWithSep, "escapes");
  }
  if (candidate === normalizedRoot) {
    throw new SessionPathEscapeError(candidate, normalizedRoot, "equals");
  }
  return candidate;
}
