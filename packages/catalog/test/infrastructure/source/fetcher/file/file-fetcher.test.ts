import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileFetcher } from "../../../../../src/infrastructure/source/fetcher/file/file-fetcher.js";

/**
 * Uses the real filesystem to cover `file:<absolutePath>` directory walks,
 * single-file fetches, symlink skipping, and filesystem errors.
 */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "glyph-file-fetcher-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function originOf(p: string): string {
  return `file:${p}`;
}

describe("FileFetcher.matches", () => {
  const f = new FileFetcher();
  it("claims file: origins", () => {
    expect(f.matches("file:/abs/path")).toBe(true);
  });
  it("ignores other schemes", () => {
    expect(f.matches("https://github.com/o/r/tree/main")).toBe(false);
    expect(f.matches("/abs/path")).toBe(false);
  });
});

describe("FileFetcher.fetch", () => {
  it("slurps a directory tree into POSIX relPath → Buffer", async () => {
    await writeFile(path.join(dir, "SKILL.md"), "anchor");
    await mkdir(path.join(dir, "references"));
    await writeFile(path.join(dir, "references", "guide.md"), "deep");
    const res = await new FileFetcher().fetch(originOf(dir));
    expect(res.isOk()).toBe(true);
    const files = res._unsafeUnwrap();
    expect(files.get("SKILL.md")?.toString()).toBe("anchor");
    expect(files.get("references/guide.md")?.toString()).toBe("deep");
  });

  it("installs a single file under its basename", async () => {
    const file = path.join(dir, "mcp.json");
    await writeFile(file, "{}");
    const res = await new FileFetcher().fetch(originOf(file));
    const files = res._unsafeUnwrap();
    expect([...files.keys()]).toEqual(["mcp.json"]);
    expect(files.get("mcp.json")?.toString()).toBe("{}");
  });

  it("skips symlinks while walking a directory", async () => {
    await writeFile(path.join(dir, "real.md"), "x");
    try {
      await symlink(path.join(dir, "real.md"), path.join(dir, "link.md"));
    } catch {
      // Skip this case when the OS does not permit test symlink creation.
      return;
    }
    const res = await new FileFetcher().fetch(originOf(dir));
    const files = res._unsafeUnwrap();
    expect(files.has("real.md")).toBe(true);
    expect(files.has("link.md")).toBe(false);
  });

  it("OriginInvalid when the path is relative", async () => {
    const res = await new FileFetcher().fetch("file:relative/path");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });

  it("OriginInvalid when the file: URI carries no path", async () => {
    const res = await new FileFetcher().fetch("file:");
    expect(res._unsafeUnwrapErr().type).toBe("OriginInvalid");
  });

  it("SourceUnavailable when the path does not exist", async () => {
    const res = await new FileFetcher().fetch(originOf(path.join(dir, "does-not-exist")));
    expect(res._unsafeUnwrapErr().type).toBe("SourceUnavailable");
  });
});
