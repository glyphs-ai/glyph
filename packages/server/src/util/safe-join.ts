import path from "node:path";

/**
 * Safely join a multi-segment relative path under a root, rejecting any
 * segment that would escape. Mirrors the per-id `safeJoinUnderRoot` from
 * the task/workflow path helpers but takes a `/`-delimited multi-segment
 * rel path (the artifact subpath).
 *
 * Throws a plain `Error` on a bad path; the artifact routes catch it and
 * map to a generic 400. The message is never surfaced on the wire, so it
 * stays terse rather than caller-facing.
 */
export function safeJoinNested(root: string, rel: string): string {
  if (rel === "" || rel.includes("\0")) {
    throw new Error("invalid artifact rel path");
  }
  const segs = rel.split(/[\\/]/);
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || s.includes("\0")) {
      throw new Error("invalid artifact rel segment");
    }
  }
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, ...segs);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (!candidate.startsWith(rootWithSep) && candidate !== normalizedRoot) {
    throw new Error("artifact path escapes root");
  }
  return candidate;
}
