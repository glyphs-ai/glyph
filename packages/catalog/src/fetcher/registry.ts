import { AzureDevOpsFetcher } from "./azure-devops-fetcher.js";
import { FetcherError } from "./errors.js";
import type { EntryFile, Fetcher } from "./fetcher.js";
import { FileFetcher } from "./file-fetcher.js";
import { GitHubFetcher } from "./github-fetcher.js";
import { type ParsedOrigin, parseOrigin } from "./origin.js";

/**
 * Lookup table from origin scheme → fetcher implementation. Built once at
 * construction and extended via {@link FetcherRegistry.register}.
 *
 * Why a registry rather than a switch?
 *
 * Tests can install a mock fetcher for a real scheme (e.g. swap
 * GitHubFetcher for one that yields from an in-memory tarball
 * fixture) without monkey-patching call sites.
 */
export class FetcherRegistry {
  private readonly bySchemeMap = new Map<string, Fetcher>();

  register(fetcher: Fetcher): void {
    this.bySchemeMap.set(fetcher.scheme, fetcher);
  }

  get(scheme: string): Fetcher | null {
    return this.bySchemeMap.get(scheme) ?? null;
  }

  /** Resolve a parsed origin to its fetcher; throws on unsupported scheme. */
  resolve(origin: ParsedOrigin): Fetcher {
    const f = this.get(origin.scheme);
    if (!f) {
      throw new FetcherError(
        `no fetcher registered for scheme "${origin.scheme}" (origin: ${origin.raw})`,
      );
    }
    return f;
  }

  /**
   * Parse `originUri`, dispatch to the matching fetcher, and read a
   * single file relative to the origin's entry root. See
   * {@link Fetcher.fetchFile} for `relPath` joining rules.
   */
  dispatchFile(originUri: string, relPath: string): Promise<Buffer> {
    const origin = parseOrigin(originUri);
    return this.resolve(origin).fetchFile(originUri, relPath);
  }

  /**
   * Parse `originUri`, dispatch to the matching fetcher, and stream
   * its full tree. Used by callers that need every regular file under
   * the origin's entry root (e.g. `SkillService.install` /
   * `AgentService.install`'s tree slurp into the files map).
   */
  dispatchTree(originUri: string): AsyncIterable<EntryFile> {
    const origin = parseOrigin(originUri);
    return this.resolve(origin).fetchTree(originUri);
  }
}

/**
 * Build the default registry shipped by glyph: local `file:` origins,
 * GitHub tree URLs, and Azure DevOps Services URLs.
 */
export function defaultFetcherRegistry(): FetcherRegistry {
  const reg = new FetcherRegistry();
  reg.register(new FileFetcher());
  reg.register(new GitHubFetcher());
  reg.register(new AzureDevOpsFetcher());
  return reg;
}
