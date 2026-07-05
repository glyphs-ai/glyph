import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { OriginInvalid, SourceUnavailable } from "../../../src/domain/source.js";
import type { FetcherRegistry } from "../../../src/infrastructure/source/fetcher/registry.js";
import { MarkdownSkillSource } from "../../../src/infrastructure/source/markdown-skill-source.js";

const ANCHOR = "SKILL.md";
const ORIGIN = "file:/catalog/skills/bar";

const VALID = `---
name: bar
description: a test skill
version: 2.0.0
dependencies:
  mcps:
    - file:/catalog/mcps/baz
---
body text
`;

function fetcherOf(files: ReadonlyMap<string, Buffer>): FetcherRegistry {
  return {
    fetchEntry: () => okAsync(files),
    fetchAnchor: (_origin: string, anchorName: string) => {
      const buf = files.get(anchorName);
      return buf
        ? okAsync(buf)
        : errAsync({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("not found") });
    },
  } as unknown as FetcherRegistry;
}

function fetcherFailing(e: OriginInvalid | SourceUnavailable): FetcherRegistry {
  return {
    fetchEntry: () => errAsync(e) as ResultAsync<ReadonlyMap<string, Buffer>, typeof e>,
    fetchAnchor: () => errAsync(e) as ResultAsync<Buffer, typeof e>,
  } as unknown as FetcherRegistry;
}

describe("MarkdownSkillSource.fetch", () => {
  it("returns {manifest, files} from anchor frontmatter + full tree", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isOk()).toBe(true);
    const { manifest, files: returnedFiles } = res._unsafeUnwrap();
    expect(manifest.name).toBe("bar");
    expect(manifest.scope).toBe("public");
    expect(manifest.version).toBe("2.0.0");
    expect(manifest.dependencyRefs.mcps).toEqual(["file:/catalog/mcps/baz"]);
    expect(returnedFiles.get(ANCHOR)).toBeDefined();
  });

  it("ManifestInvalid when anchor missing", async () => {
    const res = await new MarkdownSkillSource(fetcherOf(new Map())).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter fails manifest compliance", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter here")]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter YAML is malformed", async () => {
    const files = new Map([[ANCHOR, Buffer.from("---\nname: [unclosed\n---\nbody\n")]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates fetcher OriginInvalid / SourceUnavailable verbatim", async () => {
    const oi = await new MarkdownSkillSource(
      fetcherFailing({ type: "OriginInvalid", origin: ORIGIN, reason: "bad" }),
    ).fetch(ORIGIN);
    expect(oi._unsafeUnwrapErr().type).toBe("OriginInvalid");
    const su = await new MarkdownSkillSource(
      fetcherFailing({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("net") }),
    ).fetch(ORIGIN);
    expect(su._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});

describe("MarkdownSkillSource.resolve", () => {
  it("returns manifest from anchor-only fetch (no full tree)", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).resolve(ORIGIN);
    expect(res.isOk()).toBe(true);
    const manifest = res._unsafeUnwrap();
    expect(manifest.name).toBe("bar");
    expect(manifest.version).toBe("2.0.0");
  });

  it("ManifestInvalid when anchor parse fails via resolve", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter")]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).resolve(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates SourceUnavailable when anchor not available", async () => {
    const res = await new MarkdownSkillSource(fetcherOf(new Map())).resolve(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
