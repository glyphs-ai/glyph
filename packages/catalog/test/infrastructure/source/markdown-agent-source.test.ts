import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { OriginInvalid, SourceUnavailable } from "../../../src/domain/source.js";
import type { FetcherRegistry } from "../../../src/infrastructure/source/fetcher/registry.js";
import { MarkdownAgentSource } from "../../../src/infrastructure/source/markdown-agent-source.js";

const ANCHOR = "AGENTS.md";
const ORIGIN = "file:/catalog/agents/foo";

const VALID = `---
name: foo
description: a test agent
version: 1.0.0
dependencies:
  skills:
    - file:/catalog/skills/bar
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

describe("MarkdownAgentSource.fetch", () => {
  it("returns {manifest, files} from anchor frontmatter + full tree", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isOk()).toBe(true);
    const { manifest, files: returnedFiles } = res._unsafeUnwrap();
    expect(manifest.name).toBe("foo");
    expect(manifest.scope).toBe("public");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.dependencyRefs.skills).toEqual(["file:/catalog/skills/bar"]);
    expect(returnedFiles.get(ANCHOR)).toBeDefined();
  });

  it("ManifestInvalid when anchor missing", async () => {
    const res = await new MarkdownAgentSource(fetcherOf(new Map())).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter fails manifest compliance", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter here")]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter YAML is malformed", async () => {
    const files = new Map([[ANCHOR, Buffer.from("---\nname: [unclosed\n---\nbody\n")]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).fetch(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates fetcher OriginInvalid / SourceUnavailable verbatim", async () => {
    const oi = await new MarkdownAgentSource(
      fetcherFailing({ type: "OriginInvalid", origin: ORIGIN, reason: "bad" }),
    ).fetch(ORIGIN);
    expect(oi._unsafeUnwrapErr().type).toBe("OriginInvalid");
    const su = await new MarkdownAgentSource(
      fetcherFailing({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("net") }),
    ).fetch(ORIGIN);
    expect(su._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});

describe("MarkdownAgentSource.resolve", () => {
  it("returns manifest from anchor-only fetch (no full tree)", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).resolve(ORIGIN);
    expect(res.isOk()).toBe(true);
    const manifest = res._unsafeUnwrap();
    expect(manifest.name).toBe("foo");
    expect(manifest.version).toBe("1.0.0");
  });

  it("ManifestInvalid when anchor parse fails via resolve", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter")]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).resolve(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates SourceUnavailable when anchor not available", async () => {
    const res = await new MarkdownAgentSource(fetcherOf(new Map())).resolve(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
