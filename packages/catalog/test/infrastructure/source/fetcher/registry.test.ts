import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../../../../src/infrastructure/source/fetcher/fetcher.js";
import {
  defaultRegistry,
  FetcherRegistry,
} from "../../../../src/infrastructure/source/fetcher/registry.js";

/**
 * Leaf fetchers are faked so registry tests only cover origin matching and
 * delegation.
 */
function leaf(scheme: string, files: ReadonlyMap<string, Buffer>): Fetcher {
  return {
    matches: (u) => u.startsWith(scheme),
    fetch: vi.fn(() => okAsync(files)),
    fetchFile: vi.fn((_origin: string, relPath: string) => {
      const buf = files.get(relPath);
      return buf ? okAsync(buf) : okAsync(Buffer.alloc(0));
    }),
  };
}

describe("FetcherRegistry selection", () => {
  it("delegates to the first leaf that claims the origin", async () => {
    const a = new Map([["A.md", Buffer.from("a")]]);
    const b = new Map([["B.md", Buffer.from("b")]]);
    const reg = new FetcherRegistry([leaf("file:", a), leaf("https://", b)]);
    const res = await reg.fetchEntry("file:/x");
    expect(res._unsafeUnwrap().get("A.md")?.toString()).toBe("a");
  });

  it("first match wins when multiple leaves claim the origin", async () => {
    const first = new Map([["first", Buffer.from("1")]]);
    const second = new Map([["second", Buffer.from("2")]]);
    const reg = new FetcherRegistry([leaf("x:", first), leaf("x:", second)]);
    const res = await reg.fetchEntry("x:thing");
    expect([...res._unsafeUnwrap().keys()]).toEqual(["first"]);
  });

  it("OriginInvalid when no leaf claims the origin", async () => {
    const reg = new FetcherRegistry([leaf("file:", new Map())]);
    const res = await reg.fetchEntry("ftp://nope");
    const e = res._unsafeUnwrapErr();
    expect(e.type).toBe("OriginInvalid");
    if (e.type === "OriginInvalid") expect(e.reason).toContain("unsupported scheme");
  });

  it("OriginInvalid from an empty registry", async () => {
    const res = await new FetcherRegistry([]).fetchEntry("file:/x");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });
});

describe("FetcherRegistry.fetchAnchor", () => {
  it("delegates to the matching leaf's fetchFile", async () => {
    const files = new Map([["SKILL.md", Buffer.from("anchor content")]]);
    const reg = new FetcherRegistry([leaf("file:", files)]);
    const res = await reg.fetchAnchor("file:/x", "SKILL.md");
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().toString()).toBe("anchor content");
  });

  it("OriginInvalid when no leaf matches", async () => {
    const reg = new FetcherRegistry([leaf("file:", new Map())]);
    const res = await reg.fetchAnchor("ftp://nope", "SKILL.md");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });
});

describe("defaultRegistry wiring", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "glyph-registry-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("routes file: origins to the FileFetcher (no network)", async () => {
    await writeFile(path.join(dir, "SKILL.md"), "anchor");
    const res = await defaultRegistry().fetchEntry(`file:${dir}`);
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().get("SKILL.md")?.toString()).toBe("anchor");
  });

  it("fetchAnchor on file: fetches a single file", async () => {
    await writeFile(path.join(dir, "SKILL.md"), "single file");
    const res = await defaultRegistry().fetchAnchor(`file:${dir}`, "SKILL.md");
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().toString()).toBe("single file");
  });

  it("routes github.com origins to the GitHubFetcher (bad grammar → OriginInvalid, no network)", async () => {
    const res = await defaultRegistry().fetchEntry("https://github.com/owner/repo");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });

  it("rejects unknown schemes with OriginInvalid", async () => {
    const res = await defaultRegistry().fetchEntry("ftp://example.com/x");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });
});
