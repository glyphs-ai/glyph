import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FetchError } from "../../src/fetcher/errors.js";
import { FileFetcher } from "../../src/fetcher/file-fetcher.js";

const fetcher = new FileFetcher();
const isWin = process.platform === "win32";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "glyph-file-fetcher-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Build a `file:` origin URI for a host-absolute path. */
function fileUri(absPath: string): string {
  return `file:${absPath}`;
}

describe("FileFetcher.fetchFile origin-is-anchor tolerance", () => {
  it("returns the anchor bytes when origin URI points at AGENTS.md and caller asks for AGENTS.md", async () => {
    const dir = path.join(scratch, "engineer");
    await mkdir(dir, { recursive: true });
    const anchor = path.join(dir, "AGENTS.md");
    await writeFile(anchor, "# engineer body\n", "utf8");

    const buf = await fetcher.fetchFile(fileUri(anchor), "AGENTS.md");
    expect(buf.toString("utf8")).toBe("# engineer body\n");
  });

  it("returns the anchor bytes when origin URI points at SKILL.md and caller asks for SKILL.md", async () => {
    const dir = path.join(scratch, "tool");
    await mkdir(dir, { recursive: true });
    const anchor = path.join(dir, "SKILL.md");
    await writeFile(anchor, "# tool body\n", "utf8");

    const buf = await fetcher.fetchFile(fileUri(anchor), "SKILL.md");
    expect(buf.toString("utf8")).toBe("# tool body\n");
  });

  it("rejects basename mismatch — origin is AGENTS.md but caller asks for SKILL.md", async () => {
    const dir = path.join(scratch, "engineer");
    await mkdir(dir, { recursive: true });
    const anchor = path.join(dir, "AGENTS.md");
    await writeFile(anchor, "# engineer body\n", "utf8");

    await expect(fetcher.fetchFile(fileUri(anchor), "SKILL.md")).rejects.toBeInstanceOf(FetchError);
  });

  it("rejects basename mismatch — origin is mcp.json but caller asks for AGENTS.md", async () => {
    const dir = path.join(scratch, "vendor");
    await mkdir(dir, { recursive: true });
    const mcp = path.join(dir, "mcp.json");
    await writeFile(mcp, "{}", "utf8");

    await expect(fetcher.fetchFile(fileUri(mcp), "AGENTS.md")).rejects.toBeInstanceOf(FetchError);
  });
});

describe("FileFetcher.fetchFile existing semantics (regression guard)", () => {
  it("joins relPath against an origin that is a directory", async () => {
    const dir = path.join(scratch, "engineer");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "AGENTS.md"), "# engineer body\n", "utf8");

    const buf = await fetcher.fetchFile(fileUri(dir), "AGENTS.md");
    expect(buf.toString("utf8")).toBe("# engineer body\n");
  });

  it("returns the file bytes when origin is a single file and relPath is empty", async () => {
    const dir = path.join(scratch, "vendor");
    await mkdir(dir, { recursive: true });
    const mcp = path.join(dir, "x.json");
    await writeFile(mcp, '{"name":"x"}', "utf8");

    const buf = await fetcher.fetchFile(fileUri(mcp), "");
    expect(buf.toString("utf8")).toBe('{"name":"x"}');
  });

  it("picks the alphabetically-first regular file when origin is a directory and relPath is empty", async () => {
    const dir = path.join(scratch, "vendor");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "b.json"), "b", "utf8");
    await writeFile(path.join(dir, "a.json"), "a", "utf8");

    const buf = await fetcher.fetchFile(fileUri(dir), "");
    expect(buf.toString("utf8")).toBe("a");
  });

  it("preserves the canonical cannot-stat error when origin path does not exist", async () => {
    const missing = path.join(scratch, "nope", "AGENTS.md");
    await expect(fetcher.fetchFile(fileUri(missing), "AGENTS.md")).rejects.toBeInstanceOf(
      FetchError,
    );
  });
});

describe.skipIf(!isWin)(
  "FileFetcher.fetchFile basename match is case-insensitive on Windows",
  () => {
    it("matches AGENTS.MD on disk against requested AGENTS.md", async () => {
      const dir = path.join(scratch, "engineer");
      await mkdir(dir, { recursive: true });
      const anchor = path.join(dir, "AGENTS.MD");
      await writeFile(anchor, "# engineer body\n", "utf8");

      const buf = await fetcher.fetchFile(fileUri(anchor), "AGENTS.md");
      expect(buf.toString("utf8")).toBe("# engineer body\n");
    });
  },
);
