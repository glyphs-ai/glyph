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
  return { matches: (u) => u.startsWith(scheme), fetch: vi.fn(() => okAsync(files)) };
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

  it("routes github.com origins to the GitHubFetcher (bad grammar → OriginInvalid, no network)", async () => {
    const res = await defaultRegistry().fetchEntry("https://github.com/owner/repo");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });

  it("rejects unknown schemes with OriginInvalid", async () => {
    const res = await defaultRegistry().fetchEntry("ftp://example.com/x");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });
});
