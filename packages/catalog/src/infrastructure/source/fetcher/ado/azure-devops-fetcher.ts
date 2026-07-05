import { err, ok, type Result, ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../../../domain/source.js";
import type { Fetcher } from "../fetcher.js";
import {
  gitCredentialApprove,
  gitCredentialReject,
  invalidateAdoTokenCache,
  type ResolvedAdoToken,
  resolveDefaultAdoToken,
} from "./ado-token.js";

/**
 * Fetcher for `https://dev.azure.com/<org>/<project>/_git/<repo>?path=/<path>`
 * URIs. Only Azure DevOps Services URLs are accepted at parse time.
 *
 * `fetch` lists every item under `scopePath` (`recursionLevel=Full`), filters
 * to blobs, then reads files in parallel. An empty listing falls back to a
 * one-file fetch yielded under its basename.
 *
 * Auth uses `git credential fill`, Basic auth, then approve/reject. Tokens are
 * resolved once per call and shared across workers. Ref pinning is rejected;
 * each file is capped at 50 MB.
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const TREE_ITEM_PARALLELISM = 8;
const API_VERSION = "7.1";
const ADO_HOST = "https://dev.azure.com";

interface AdoOrigin {
  readonly org: string;
  readonly project: string;
  readonly repo: string;
  readonly path: string;
}

interface EntryFile {
  readonly relPath: string;
  readonly content: Buffer;
}

interface TreeItem {
  readonly path: string;
  readonly gitObjectType: string;
}

function parseAdo(uri: string): Result<AdoOrigin, OriginInvalid> {
  const reject = (reason: string): Result<AdoOrigin, OriginInvalid> =>
    err({ type: "OriginInvalid", origin: uri, reason });

  if (/^https:\/\/[^/]+\.visualstudio\.com\//i.test(uri)) {
    return reject(
      "*.visualstudio.com is legacy; use dev.azure.com/{org}/{project}/_git/{repo}?path=/...",
    );
  }
  if (/^https:\/\/(tfs\.[^/]+|[^/]+\/tfs\/)/i.test(uri)) {
    return reject("on-prem TFS unsupported; only dev.azure.com");
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return reject("malformed dev.azure.com URL");
  }
  if (parsed.searchParams.has("version")) {
    return reject("&version= unsupported; installs from default branch");
  }
  const segs = parsed.pathname.split("/");
  const shapeOk =
    (segs.length === 5 || (segs.length === 6 && segs[5] === "")) &&
    segs[1] !== "" &&
    segs[2] !== "" &&
    segs[3] === "_git" &&
    segs[4] !== "";
  if (!shapeOk) {
    return reject("expected dev.azure.com/{org}/{project}/_git/{repo}?path=/...");
  }
  const org = decodeURIComponent(segs[1]!);
  const project = decodeURIComponent(segs[2]!);
  const repo = decodeURIComponent(segs[4]!);
  const rawPath = parsed.searchParams.get("path");
  if (rawPath === null || rawPath === "") {
    return reject("requires ?path=/... naming a file or directory");
  }
  const normPath = (rawPath.startsWith("/") ? rawPath : `/${rawPath}`).replace(/\/+$/, "");
  if (normPath === "") return reject("?path= empty after trimming");
  return ok({ org, project, repo, path: normPath });
}

export class AzureDevOpsFetcher implements Fetcher {
  matches(uri: string): boolean {
    return (
      uri.startsWith(`${ADO_HOST}/`) ||
      /^https:\/\/[^/]+\.visualstudio\.com\//i.test(uri) ||
      /^https:\/\/(tfs\.[^/]+|[^/]+\/tfs\/)/i.test(uri)
    );
  }

  fetch(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable> {
    return parseAdo(origin).asyncAndThen((parsed) =>
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
    return parseAdo(origin).asyncAndThen((parsed) =>
      ResultAsync.fromPromise<Buffer, SourceUnavailable>(
        (async () => {
          const cred = await resolveDefaultAdoToken(parsed.org, parsed.repo);
          const fullPath = parsed.path.replace(/\/+$/, "") + "/" + relPath;
          return this.fetchItemRaw(parsed.org, parsed.project, parsed.repo, fullPath, cred);
        })(),
        (cause) => ({ type: "SourceUnavailable", origin, cause }),
      ),
    );
  }

  private async slurp(parsed: AdoOrigin): Promise<ReadonlyMap<string, Buffer>> {
    const files = new Map<string, Buffer>();
    for await (const file of this.stream(parsed)) files.set(file.relPath, file.content);
    return files;
  }

  private async *stream(parsed: AdoOrigin): AsyncIterable<EntryFile> {
    const { org, project, repo, path: subPath } = parsed;

    // Resolve the credential EXACTLY ONCE before fanning out, else N cold
    // workers could each pop a GCM dialog. Shared through every request.
    const cred = await resolveDefaultAdoToken(org, repo);
    const listing = await this.listTreeAt(org, project, repo, subPath, cred);

    // Empty listing → ADO treats scopePath as a single file. Fall back to a
    // direct fetch yielded as basename (matches github's single-file branch).
    if (listing.length === 0) {
      const content = await this.fetchItemRaw(org, project, repo, subPath, cred);
      const slashIdx = subPath.lastIndexOf("/");
      yield { relPath: slashIdx >= 0 ? subPath.slice(slashIdx + 1) : subPath, content };
      return;
    }

    const subPrefix = subPath.replace(/\/+$/, "");
    const planned: { adoPath: string; relPath: string }[] = [];
    for (const entry of listing) {
      if (entry.gitObjectType !== "blob") continue;
      const p = entry.path;
      if (p === subPrefix) {
        const slashIdx = subPrefix.lastIndexOf("/");
        planned.push({
          adoPath: p,
          relPath: slashIdx >= 0 ? subPrefix.slice(slashIdx + 1) : subPrefix,
        });
      } else if (p.startsWith(`${subPrefix}/`)) {
        planned.push({ adoPath: p, relPath: p.slice(subPrefix.length + 1) });
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
          content: await this.fetchItemRaw(org, project, repo, job.adoPath, cred),
        };
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(TREE_ITEM_PARALLELISM, planned.length); i++)
      workers.push(worker());
    await Promise.all(workers);
    for (const file of results) yield file;
  }

  private async listTreeAt(
    org: string,
    project: string,
    repo: string,
    scopePath: string,
    cred: ResolvedAdoToken | null,
  ): Promise<TreeItem[]> {
    const url = this.itemsUrl(org, project, repo, [
      ["scopePath", scopePath],
      ["recursionLevel", "Full"],
      ["api-version", API_VERSION],
    ]);
    const response = await fetch(url, {
      headers: this.headers("application/json", cred),
      redirect: "follow",
    });
    if (!response.ok) {
      try {
        await response.text();
      } catch {}
      this.maybeConfirmCred(response, cred, org, repo);
      throw new Error(
        `ADO Items API ${response.status} ${response.statusText} for tree "${scopePath}"`,
      );
    }
    const json = (await response.json()) as {
      value?: ReadonlyArray<{ path?: unknown; gitObjectType?: unknown }>;
    };
    this.maybeConfirmCred(response, cred, org, repo);
    const items: TreeItem[] = [];
    if (Array.isArray(json.value)) {
      for (const e of json.value) {
        if (
          e &&
          typeof e === "object" &&
          typeof e.path === "string" &&
          typeof e.gitObjectType === "string"
        ) {
          items.push({ path: e.path, gitObjectType: e.gitObjectType });
        }
      }
    }
    return items;
  }

  private async fetchItemRaw(
    org: string,
    project: string,
    repo: string,
    path: string,
    cred: ResolvedAdoToken | null,
  ): Promise<Buffer> {
    const url = this.itemsUrl(org, project, repo, [
      ["path", path],
      ["api-version", API_VERSION],
    ]);
    const response = await fetch(url, {
      headers: this.headers("application/octet-stream", cred),
      redirect: "follow",
    });
    if (!response.ok) {
      try {
        await response.text();
      } catch {}
      this.maybeConfirmCred(response, cred, org, repo);
      throw new Error(`ADO Items API ${response.status} ${response.statusText} for ${path}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES}-byte cap`);
    this.maybeConfirmCred(response, cred, org, repo);
    return buf;
  }

  /**
   * Run the matching git credential helper action: 2xx → approve, 401/403 →
   * reject + cache-invalidate, else no-op. Only for `git-credential`-sourced
   * tokens. Fire-and-forget; never blocks.
   */
  private maybeConfirmCred(
    response: Response,
    cred: ResolvedAdoToken | null,
    org: string,
    repo: string,
  ): void {
    if (cred === null || cred.source !== "git-credential") return;
    if (response.ok) {
      void gitCredentialApprove(org, repo, cred.username, cred.token);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      void gitCredentialReject(org, repo, cred.username, cred.token);
      invalidateAdoTokenCache(org, repo);
    }
  }

  private itemsUrl(
    org: string,
    project: string,
    repo: string,
    query: ReadonlyArray<readonly [string, string]>,
  ): string {
    const qs = query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `${ADO_HOST}/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${repo}/items?${qs}`;
  }

  /** `Authorization: Basic base64(":" + token)` works for both PAT and AAD JWT. */
  private headers(accept: string, cred: ResolvedAdoToken | null): Record<string, string> {
    const h: Record<string, string> = { "User-Agent": "glyph-catalog", Accept: accept };
    if (cred !== null)
      h.Authorization = `Basic ${Buffer.from(`:${cred.token}`, "utf8").toString("base64")}`;
    return h;
  }
}
