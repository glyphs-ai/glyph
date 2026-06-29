import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { OriginInvalid, SourceUnavailable } from "../../../src/domain/source.js";
import type { FetcherRegistry } from "../../../src/infrastructure/source/fetcher/registry.js";
import { MarkdownAgentSource } from "../../../src/infrastructure/source/markdown-agent-source.js";

/**
 * The fetcher is stubbed so `MarkdownAgentSource` tests do not touch the
 * filesystem or network.
 */
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
  return { fetchEntry: () => okAsync(files) } as unknown as FetcherRegistry;
}

function fetcherFailing(e: OriginInvalid | SourceUnavailable): FetcherRegistry {
  return {
    fetchEntry: () => errAsync(e) as ResultAsync<ReadonlyMap<string, Buffer>, typeof e>,
  } as unknown as FetcherRegistry;
}

describe("MarkdownAgentSource", () => {
  it("builds a manifest from anchor frontmatter + files", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isOk()).toBe(true);
    const m = res._unsafeUnwrap();
    expect(m.name).toBe("foo");
    expect(m.scope).toBe("public");
    expect(m.version).toBe("1.0.0");
    expect(m.dependencyRefs.skills).toEqual(["file:/catalog/skills/bar"]);
    expect(m.files.get(ANCHOR)).toBeDefined();
  });

  it("ManifestInvalid when anchor missing", async () => {
    const res = await new MarkdownAgentSource(fetcherOf(new Map())).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter fails manifest compliance", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter here")]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter YAML is malformed", async () => {
    const files = new Map([[ANCHOR, Buffer.from("---\nname: [unclosed\n---\nbody\n")]]);
    const res = await new MarkdownAgentSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates fetcher OriginInvalid / SourceUnavailable verbatim", async () => {
    const oi = await new MarkdownAgentSource(
      fetcherFailing({ type: "OriginInvalid", origin: ORIGIN, reason: "bad" }),
    ).load(ORIGIN);
    expect(oi._unsafeUnwrapErr().type).toBe("OriginInvalid");
    const su = await new MarkdownAgentSource(
      fetcherFailing({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("net") }),
    ).load(ORIGIN);
    expect(su._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
