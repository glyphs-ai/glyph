import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import * as tar from "tar-stream";
import type { OriginInvalid, SourceUnavailable } from "../../../../domain/source.js";
import type { Fetcher } from "../fetcher.js";
import { resolveDefaultGitHubToken } from "./gh-token.js";

/**
 * Fetcher for `https://github.com/<owner>/<repo>/tree/<ref>[/path]` URIs.
 * Owns the github grammar end-to-end. `fetch` picks a transport by origin
 * shape:
 *
 *  - **subpath** origin → Git Trees API (`/git/trees/{ref}?recursive=1`)
 *    lists every blob once, filters to the subpath, then fans out parallel
 *    Blobs API reads. Falls back to tarball if the listing is truncated.
 *  - **whole-repo** origin or truncated listing → Tarball API, gunzip +
 *    tar-extract on the fly.
 *
 * **Auth**: optional. Token via env → `gh auth token`; attached as
 * `Authorization: Bearer`. Anonymous works for public repos. Malformed
 * origin → `OriginInvalid`; transport/4xx/5xx → `SourceUnavailable`.
 * **50 MB per-file cap.**
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const TREE_BLOB_PARALLELISM = 8;

const GITHUB_TREE_RE =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/tree\/([^/\s]+)(?:\/(.+))?\/?$/;

/** Encode a file path for URLs, keeping slashes literal. */
function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

interface GitHubOrigin {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly path: string | null;
}

interface EntryFile {
  readonly relPath: string;
  readonly content: Buffer;
}

function parseGitHub(uri: string): Result<GitHubOrigin, OriginInvalid> {
  const m = uri.match(GITHUB_TREE_RE);
  if (!m) {
    return err({
      type: "OriginInvalid",
      origin: uri,
      reason: "expected https://github.com/<owner>/<repo>/tree/<ref>[/path]",
    });
  }
  const [, owner, repo, ref, path] = m;
  return ok({
    owner: owner!,
    repo: repo!,
    ref: ref!,
    path: path && path.length > 0 ? path.replace(/\/+$/, "") : null,
  });
}

export class GitHubFetcher implements Fetcher {
  matches(uri: string): boolean {
    return uri.startsWith("https://github.com/");
  }

  fetch(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable> {
    return parseGitHub(origin).asyncAndThen((parsed) =>
      ResultAsync.fromPromise<ReadonlyMap<string, Buffer>, SourceUnavailable>(
        this.slurp(parsed),
        (cause) => ({
          type: "SourceUnavailable",
          origin,
          cause,
        }),
      ),
    );
  }

  fetchFile(
    origin: string,
    relPath: string,
  ): ResultAsync<Buffer, OriginInvalid | SourceUnavailable> {
    return parseGitHub(origin).asyncAndThen((parsed) =>
      ResultAsync.fromPromise<Buffer, SourceUnavailable>(
        this.fetchSingleFile(parsed, relPath),
        (cause) => ({ type: "SourceUnavailable", origin, cause }),
      ),
    );
  }

  /** Single-file download via the GitHub Contents API (returns base64). */
  private async fetchSingleFile(parsed: GitHubOrigin, relPath: string): Promise<Buffer> {
    const { owner, repo, ref, path: subPath } = parsed;
    const fullPath = subPath ? `${subPath}/${relPath}` : relPath;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(fullPath)}?ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url, {
      headers: await this.headers("application/vnd.github+json"),
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`GitHub Contents API returned ${response.status} for ${fullPath}`);
    }
    const json = (await response.json()) as { content?: string; encoding?: string };
    if (json.encoding !== "base64" || typeof json.content !== "string") {
      throw new Error(`unexpected Contents API response for ${fullPath}`);
    }
    return Buffer.from(json.content.replace(/\n/g, ""), "base64");
  }

  private async slurp(parsed: GitHubOrigin): Promise<ReadonlyMap<string, Buffer>> {
    const files = new Map<string, Buffer>();
    for await (const file of this.stream(parsed)) files.set(file.relPath, file.content);
    return files;
  }

  private async *stream(parsed: GitHubOrigin): AsyncIterable<EntryFile> {
    const { owner, repo, ref, path: subPath } = parsed;

    // Whole-repo install: the tarball is a single streaming HTTPS download
    // vs N parallel round-trips for every blob. Skip the Trees+Blobs path.
    if (subPath === null) {
      yield* this.fetchTreeViaTarball(owner, repo, ref, null);
      return;
    }

    // Subpath install: Contents API lists just the directory's files (one
    // call per level). Much faster than listing the full repo tree.
    const listing = await this.fetchContentsRecursive(owner, repo, ref, subPath);
    if (listing !== null && listing.length > 0) {
      yield* this.fetchBlobsFromListing(owner, repo, listing);
      return;
    }

    // Fallback: full recursive tree listing → filter → parallel blobs.
    const tree = await this.fetchTreeListing(owner, repo, ref);
    if (tree === null) {
      yield* this.fetchTreeViaTarball(owner, repo, ref, subPath);
      return;
    }
    yield* this.fetchTreeViaBlobs(owner, repo, subPath, tree);
  }

  /**
   * List directory contents recursively via the GitHub Contents API.
   * Returns flat list of {sha, relPath} for all files under the path.
   * Returns null on API failure (caller falls back to Trees API).
   */
  private async fetchContentsRecursive(
    owner: string,
    repo: string,
    ref: string,
    subPath: string,
  ): Promise<{ sha: string; relPath: string }[] | null> {
    const result: { sha: string; relPath: string }[] = [];
    const queue: string[] = [subPath];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(dir)}?ref=${encodeURIComponent(ref)}`;
      let response: Response;
      try {
        response = await fetch(url, {
          headers: await this.headers("application/vnd.github+json"),
          redirect: "follow",
        });
      } catch {
        return null;
      }
      if (!response.ok) return null;
      let entries: Array<{ name: string; path: string; sha: string; type: string }>;
      try {
        const json = await response.json();
        if (!Array.isArray(json)) return null;
        entries = json;
      } catch {
        return null;
      }
      for (const entry of entries) {
        if (entry.type === "file") {
          const relPath = entry.path.startsWith(`${subPath}/`)
            ? entry.path.slice(subPath.length + 1)
            : entry.name;
          result.push({ sha: entry.sha, relPath });
        } else if (entry.type === "dir") {
          queue.push(entry.path);
        }
      }
    }
    return result;
  }

  private async *fetchBlobsFromListing(
    owner: string,
    repo: string,
    listing: { sha: string; relPath: string }[],
  ): AsyncIterable<EntryFile> {
    const results: EntryFile[] = new Array(listing.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= listing.length) return;
        const job = listing[i]!;
        results[i] = {
          relPath: job.relPath,
          content: await this.fetchBlobRaw(owner, repo, job.sha),
        };
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(TREE_BLOB_PARALLELISM, listing.length); i++)
      workers.push(worker());
    await Promise.all(workers);
    for (const file of results) yield file;
  }

  private async fetchTreeListing(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<TreeBlobEntry[] | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const response = await fetch(url, {
      headers: await this.headers("application/vnd.github+json"),
      redirect: "follow",
    });
    if (!response.ok) {
      try {
        await response.text();
      } catch {}
      throw new Error(`GitHub Trees API returned ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as TreeListingResponse;
    if (json.truncated === true) return null;
    if (!Array.isArray(json.tree)) throw new Error("Trees API response missing `tree` array");
    const blobs: TreeBlobEntry[] = [];
    for (const entry of json.tree) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string"
      ) {
        blobs.push({ path: entry.path, sha: entry.sha });
      }
    }
    return blobs;
  }

  private async *fetchTreeViaBlobs(
    owner: string,
    repo: string,
    subPath: string,
    tree: TreeBlobEntry[],
  ): AsyncIterable<EntryFile> {
    const subPrefix = subPath.replace(/\/+$/, "");
    const planned: { sha: string; relPath: string }[] = [];
    for (const blob of tree) {
      if (blob.path === subPrefix) {
        const slashIdx = subPrefix.lastIndexOf("/");
        planned.push({
          sha: blob.sha,
          relPath: slashIdx >= 0 ? subPrefix.slice(slashIdx + 1) : subPrefix,
        });
      } else if (blob.path.startsWith(`${subPrefix}/`)) {
        planned.push({ sha: blob.sha, relPath: blob.path.slice(subPrefix.length + 1) });
      }
    }
    if (planned.length === 0) throw new Error(`subpath "${subPath}" matched no blobs in the tree`);

    const results: EntryFile[] = new Array(planned.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= planned.length) return;
        const job = planned[i];
        if (job === undefined) return;
        results[i] = {
          relPath: job.relPath,
          content: await this.fetchBlobRaw(owner, repo, job.sha),
        };
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(TREE_BLOB_PARALLELISM, planned.length); i++)
      workers.push(worker());
    await Promise.all(workers);
    for (const file of results) yield file;
  }

  private async fetchBlobRaw(owner: string, repo: string, sha: string): Promise<Buffer> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`;
    const response = await fetch(url, {
      headers: await this.headers("application/vnd.github.raw"),
      redirect: "follow",
    });
    if (!response.ok) {
      try {
        await response.text();
      } catch {}
      throw new Error(
        `GitHub Blobs API returned ${response.status} ${response.statusText} for blob ${sha}`,
      );
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES)
      throw new Error(`blob ${sha} exceeds ${MAX_FILE_BYTES}-byte cap`);
    return buf;
  }

  private async headers(accept: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "User-Agent": "glyph-catalog", Accept: accept };
    const token = await resolveDefaultGitHubToken("github.com");
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async *fetchTreeViaTarball(
    owner: string,
    repo: string,
    ref: string,
    subPath: string | null,
  ): AsyncIterable<EntryFile> {
    const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
    const response = await fetch(url, {
      headers: await this.headers("application/vnd.github+json"),
      redirect: "follow",
    });
    if (!response.ok) {
      try {
        await response.text();
      } catch {}
      throw new Error(`GitHub tarball API returned ${response.status} ${response.statusText}`);
    }
    if (!response.body) throw new Error("GitHub tarball response has no body");

    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    const gunzip = createGunzip();
    const extract = tar.extract();
    nodeStream.on("error", (err) => extract.destroy(err));
    gunzip.on("error", (err) => extract.destroy(err));
    nodeStream.pipe(gunzip).pipe(extract);

    let prefix: string | null = null;
    const subPrefix = subPath ? subPath.replace(/\/+$/, "") : null;

    for await (const entry of extractEntries(extract)) {
      const { headerName, type, content } = entry;
      if (type !== "file") continue;
      if (prefix === null) {
        const slash = headerName.indexOf("/");
        prefix = slash >= 0 ? headerName.slice(0, slash + 1) : "";
      }
      if (!headerName.startsWith(prefix)) continue;
      const afterPrefix = headerName.slice(prefix.length);
      let relPath: string;
      if (subPrefix) {
        if (afterPrefix === subPrefix) {
          const slashIdx = subPrefix.lastIndexOf("/");
          relPath = slashIdx >= 0 ? subPrefix.slice(slashIdx + 1) : subPrefix;
        } else if (afterPrefix.startsWith(`${subPrefix}/`)) {
          relPath = afterPrefix.slice(subPrefix.length + 1);
        } else {
          continue;
        }
      } else {
        relPath = afterPrefix;
      }
      if (relPath === "") continue;
      if (content.length > MAX_FILE_BYTES) continue;
      yield { relPath, content };
    }
  }
}

interface TreeBlobEntry {
  readonly path: string;
  readonly sha: string;
}

interface TreeListingResponse {
  readonly tree?: ReadonlyArray<{
    readonly path?: unknown;
    readonly type?: unknown;
    readonly sha?: unknown;
  }>;
  readonly truncated?: boolean;
}

interface RawEntry {
  headerName: string;
  type: string;
  content: Buffer;
}

/**
 * Adapt the event-driven `tar-stream` extract into an async iterable of
 * `RawEntry`. Buffers per-file content so consumers don't deal with
 * back-pressure inside the tar parser; entries are tiny (<100 KB skills).
 */
async function* extractEntries(extract: tar.Extract): AsyncIterable<RawEntry> {
  const queue: RawEntry[] = [];
  let done = false;
  let error: Error | null = null;
  const wakers: Array<() => void> = [];
  const wake = () => {
    while (wakers.length > 0) wakers.shift()!();
  };

  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      queue.push({
        headerName: header.name,
        type: header.type ?? "file",
        content: Buffer.concat(chunks),
      });
      next();
      wake();
    });
    stream.on("error", (err) => {
      error = err;
      next(err);
      wake();
    });
  });
  extract.on("finish", () => {
    done = true;
    wake();
  });
  extract.on("error", (err) => {
    error = err;
    done = true;
    wake();
  });

  while (true) {
    if (error) throw error;
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) return;
    await new Promise<void>((resolve) => wakers.push(resolve));
  }
}
