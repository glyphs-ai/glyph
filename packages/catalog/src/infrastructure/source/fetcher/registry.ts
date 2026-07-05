/**
 * `FetcherRegistry` — origin URI → in-memory file tree. The single root the
 * source adapters compose: it picks the first {@link Fetcher} leaf that owns
 * a URI and delegates. Leaves own grammar, transport, AND error translation;
 * the root only selects. No match → `OriginInvalid`; everything else is the
 * leaf's already-typed `ResultAsync`. Adding a scheme is a closed change —
 * register one more leaf. First match wins, so register most- to
 * least-specific.
 *
 * Domain / application MUST NOT depend on this; they depend on the typed
 * `Source<T>` ports.
 */

import { errAsync, type ResultAsync } from "neverthrow";
import type { OriginInvalid, SourceUnavailable } from "../../../domain/source.js";
import { AzureDevOpsFetcher } from "./ado/azure-devops-fetcher.js";
import type { Fetcher } from "./fetcher.js";
import { FileFetcher } from "./file/file-fetcher.js";
import { GitHubFetcher } from "./github/github-fetcher.js";

export class FetcherRegistry {
  private readonly fetchers: Fetcher[];

  constructor(fetchers: Fetcher[]) {
    this.fetchers = fetchers;
  }

  fetchEntry(
    origin: string,
  ): ResultAsync<ReadonlyMap<string, Buffer>, OriginInvalid | SourceUnavailable> {
    const leaf = this.fetchers.find((x) => x.matches(origin));
    if (!leaf) return errAsync(this.unsupported(origin));
    return leaf.fetch(origin);
  }

  /**
   * Fetch only the anchor file from an origin via the leaf's single-file API.
   * Much faster than fetchEntry for resolve (avoids downloading the full tree).
   */
  fetchAnchor(
    origin: string,
    anchorName: string,
  ): ResultAsync<Buffer, OriginInvalid | SourceUnavailable> {
    const leaf = this.fetchers.find((x) => x.matches(origin));
    if (!leaf) return errAsync(this.unsupported(origin));
    return leaf.fetchFile(origin, anchorName);
  }

  private unsupported(origin: string): OriginInvalid {
    return {
      type: "OriginInvalid",
      origin,
      reason:
        "unsupported scheme; supported origins are " +
        "https://github.com/<owner>/<repo>/tree/<ref>[/path], " +
        "https://dev.azure.com/<org>/<project>/_git/<repo>?path=/..., " +
        "and file:<absolutePath>",
    };
  }
}

/**
 * Build the default registry shipped by glyph: local `file:` origins,
 * GitHub tree URLs, and Azure DevOps Services URLs.
 */
export function defaultRegistry(): FetcherRegistry {
  return new FetcherRegistry([new FileFetcher(), new GitHubFetcher(), new AzureDevOpsFetcher()]);
}
