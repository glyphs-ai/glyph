import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../../../domain/source.js";
import type { Fetcher } from "../fetcher.js";

/**
 * Fetcher for `file:<absolutePath>` origins. Owns the file grammar
 * end-to-end: a directory installs every file under it (symlinks skipped);
 * a single file installs as its basename. **50 MB per-file cap.** Malformed
 * origin → `OriginInvalid`; fs fault → `SourceUnavailable`.
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function isAbsolutePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/")) return true;
  if (p.startsWith("\\\\")) return true; // Windows UNC
  if (p.length >= 3 && /^[a-zA-Z]:[\\/]/.test(p)) return true;
  return false;
}

function parseFile(uri: string): Result<string, OriginInvalid> {
  const rest = uri.slice("file:".length);
  if (rest.length === 0) {
    return err({
      type: "OriginInvalid",
      origin: uri,
      reason: "file: URI requires a path (e.g. file:/abs/path)",
    });
  }
  let stripped = rest.startsWith("//") ? rest.slice(2) : rest;
  if (/^\/[a-zA-Z]:[\\/]/.test(stripped)) stripped = stripped.slice(1);
  if (!isAbsolutePath(stripped)) {
    return err({
      type: "OriginInvalid",
      origin: uri,
      reason:
        'file: URI must be an absolute path (e.g. "file:/Users/me/skills/x" or "file:///C:/Users/me/skills/x")',
    });
  }
  return ok(stripped);
}

function toPosix(p: string): string {
  return path.sep === "/" ? p : p.split(path.sep).join("/");
}

export class FileFetcher implements Fetcher {
  matches(uri: string): boolean {
    return uri.startsWith("file:");
  }

  fetch(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable> {
    return parseFile(origin).asyncAndThen((src) =>
      ResultAsync.fromPromise<ReadonlyMap<string, Buffer>, SourceUnavailable>(
        slurp(src),
        (cause) => ({
          type: "SourceUnavailable",
          origin,
          cause,
        }),
      ),
    );
  }
}

async function slurp(src: string): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const s = await stat(src);
  if (s.isDirectory()) {
    await walk(src, "", files);
  } else {
    if (s.size > MAX_FILE_BYTES) throw new Error(`source file exceeds ${MAX_FILE_BYTES}-byte cap`);
    files.set(path.basename(src), await readFile(src));
  }
  return files;
}

async function walk(absRoot: string, relParent: string, out: Map<string, Buffer>): Promise<void> {
  const here = relParent ? path.join(absRoot, ...relParent.split("/")) : absRoot;
  for (const ent of await readdir(here, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const childRel = relParent ? `${relParent}/${ent.name}` : ent.name;
    const abs = path.join(here, ent.name);
    if (ent.isDirectory()) {
      await walk(absRoot, childRel, out);
    } else if (ent.isFile()) {
      if ((await stat(abs)).size > MAX_FILE_BYTES) continue;
      out.set(toPosix(childRel), await readFile(abs));
    }
  }
}
