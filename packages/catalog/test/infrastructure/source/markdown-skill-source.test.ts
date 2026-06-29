import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { OriginInvalid, SourceUnavailable } from "../../../src/domain/source.js";
import type { FetcherRegistry } from "../../../src/infrastructure/source/fetcher/registry.js";
import { MarkdownSkillSource } from "../../../src/infrastructure/source/markdown-skill-source.js";

/**
 * The fetcher is stubbed so `MarkdownSkillSource` tests do not touch the
 * filesystem or network.
 */
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
  return { fetchEntry: () => okAsync(files) } as unknown as FetcherRegistry;
}

function fetcherFailing(e: OriginInvalid | SourceUnavailable): FetcherRegistry {
  return {
    fetchEntry: () => errAsync(e) as ResultAsync<ReadonlyMap<string, Buffer>, typeof e>,
  } as unknown as FetcherRegistry;
}

describe("MarkdownSkillSource", () => {
  it("builds a manifest from anchor frontmatter + files", async () => {
    const files = new Map([[ANCHOR, Buffer.from(VALID)]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isOk()).toBe(true);
    const m = res._unsafeUnwrap();
    expect(m.name).toBe("bar");
    expect(m.scope).toBe("public");
    expect(m.version).toBe("2.0.0");
    expect(m.dependencyRefs.mcps).toEqual(["file:/catalog/mcps/baz"]);
    expect(m.files.get(ANCHOR)).toBeDefined();
  });

  it("ManifestInvalid when anchor missing", async () => {
    const res = await new MarkdownSkillSource(fetcherOf(new Map())).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter fails manifest compliance", async () => {
    const files = new Map([[ANCHOR, Buffer.from("no frontmatter here")]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("ManifestInvalid when frontmatter YAML is malformed", async () => {
    const files = new Map([[ANCHOR, Buffer.from("---\nname: [unclosed\n---\nbody\n")]]);
    const res = await new MarkdownSkillSource(fetcherOf(files)).load(ORIGIN);
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().type).toBe("ManifestInvalid");
  });

  it("propagates fetcher OriginInvalid / SourceUnavailable verbatim", async () => {
    const oi = await new MarkdownSkillSource(
      fetcherFailing({ type: "OriginInvalid", origin: ORIGIN, reason: "bad" }),
    ).load(ORIGIN);
    expect(oi._unsafeUnwrapErr().type).toBe("OriginInvalid");
    const su = await new MarkdownSkillSource(
      fetcherFailing({ type: "SourceUnavailable", origin: ORIGIN, cause: new Error("net") }),
    ).load(ORIGIN);
    expect(su._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
