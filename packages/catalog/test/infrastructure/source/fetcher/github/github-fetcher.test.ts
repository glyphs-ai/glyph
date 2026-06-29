import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `globalThis.fetch` is stubbed so no network requests are made. `gh-token`
 * is mocked so token resolution never spawns the real `gh` CLI.
 */
const { tokenRef } = vi.hoisted(() => ({ tokenRef: { value: null as string | null } }));

vi.mock("../../../../../src/infrastructure/source/fetcher/github/gh-token.js", () => ({
  resolveDefaultGitHubToken: async () => tokenRef.value,
  tryGhAuthToken: async () => tokenRef.value,
}));

import { GitHubFetcher } from "../../../../../src/infrastructure/source/fetcher/github/github-fetcher.js";

const ORIG_FETCH = globalThis.fetch;
let capturedAuth: string | null = null;

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  tokenRef.value = null;
});

function stubFetch(route: (url: string) => Response): void {
  capturedAuth = null;
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    capturedAuth = new Headers(init?.headers).get("Authorization");
    return route(String(url));
  }) as unknown as typeof globalThis.fetch;
}

const SUBPATH = "https://github.com/owner/repo/tree/main/skills/bar";
const WHOLE_REPO = "https://github.com/owner/repo/tree/main";

function treeListing(): Response {
  return new Response(
    JSON.stringify({
      truncated: false,
      tree: [{ type: "blob", path: "skills/bar/SKILL.md", sha: "deadbeef" }],
    }),
    { status: 200 },
  );
}

describe("GitHubFetcher.matches", () => {
  const f = new GitHubFetcher();
  it("claims github.com https origins", () => {
    expect(f.matches("https://github.com/o/r/tree/main")).toBe(true);
  });
  it("ignores other origins", () => {
    expect(f.matches("file:/x")).toBe(false);
    expect(f.matches("https://dev.azure.com/o/p/_git/r")).toBe(false);
  });
});

describe("GitHubFetcher.fetch", () => {
  it("subpath install fetches via the Trees + Blobs API", async () => {
    tokenRef.value = "ghp_testtoken";
    stubFetch((u) => {
      if (u.includes("/git/trees/")) return treeListing();
      if (u.includes("/git/blobs/"))
        return new Response(Buffer.from("anchor bytes"), { status: 200 });
      return new Response("no", { status: 404 });
    });
    const res = await new GitHubFetcher().fetch(SUBPATH);
    expect(res.isOk()).toBe(true);
    const files = res._unsafeUnwrap();
    expect(files.get("SKILL.md")?.toString()).toBe("anchor bytes");
    expect(capturedAuth).toBe("Bearer ghp_testtoken");
  });

  it("omits Authorization when no token resolves", async () => {
    tokenRef.value = null;
    stubFetch((u) =>
      u.includes("/git/trees/") ? treeListing() : new Response(Buffer.from("hi"), { status: 200 }),
    );
    const res = await new GitHubFetcher().fetch(SUBPATH);
    expect(res.isOk()).toBe(true);
    expect(capturedAuth).toBeNull();
  });

  it("OriginInvalid when the URL lacks /tree/<ref> (no network)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    const res = await new GitHubFetcher().fetch("https://github.com/owner/repo");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
    expect(spy).not.toHaveBeenCalled();
  });

  it("SourceUnavailable when the Trees API returns non-2xx", async () => {
    stubFetch(() => new Response("forbidden", { status: 404, statusText: "Not Found" }));
    const res = await new GitHubFetcher().fetch(SUBPATH);
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });

  it("SourceUnavailable when the whole-repo tarball download fails", async () => {
    stubFetch(() => new Response("nope", { status: 500, statusText: "Server Error" }));
    const res = await new GitHubFetcher().fetch(WHOLE_REPO);
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });

  it("never leaks the token into the SourceUnavailable cause", async () => {
    tokenRef.value = "ghp_supersecret";
    stubFetch(() => new Response("denied", { status: 401, statusText: "Unauthorized" }));
    const res = await new GitHubFetcher().fetch(SUBPATH);
    const e = res._unsafeUnwrapErr();
    expect(e.type).toBe("SourceUnavailable");
    if (e.type === "SourceUnavailable") {
      const cause = e.cause instanceof Error ? e.cause.message : String(e.cause);
      expect(cause).not.toContain("ghp_supersecret");
    }
  });
});
