import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Browser-safety probe. The dashboard (React 19 + Vite) will eventually
 * import this SDK, so the generated client MUST NOT drag any Node-only
 * code (`node:` URLs, `require("fs"|"path"|"child_process")`) into a
 * browser bundle. We bundle the package's PUBLIC surface with Vite in
 * browser mode (`build.ssr = false`) and assert the emitted chunk is
 * clean.
 *
 * The alias points at the built `dist/` — the shipped artifact a consumer
 * resolves — so this test requires `pnpm build` first (the quality gate
 * and CI both build before running tests).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const SDK_ENTRY = path.join(PKG_ROOT, "dist", "index.js");

const NODE_LEAK_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["node: protocol", /node:/],
  ['require("fs")', /require\(\s*["']fs["']\s*\)/],
  ['require("path")', /require\(\s*["']path["']\s*\)/],
  ['require("child_process")', /require\(\s*["']child_process["']\s*\)/],
];

describe("@glyphs-ai/sdk browser bundle safety", () => {
  let workDir = "";

  // This probe bundles the SHIPPED artifact at `dist/index.js`, so it only
  // makes sense after a build. Fail fast with an actionable message instead
  // of a confusing ENOENT when run standalone (`pnpm -F @glyphs-ai/sdk test`)
  // without a prior build.
  beforeAll(() => {
    if (!existsSync(SDK_ENTRY)) {
      throw new Error(
        `${SDK_ENTRY} not found. Run \`pnpm -F @glyphs-ai/sdk build\` first ` +
          "(or `pnpm build` at the repo root), then re-run this test.",
      );
    }
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("bundles for the browser with zero Node-only leaks", async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "glyph-sdk-bundle-"));
    const outDir = path.join(workDir, "dist");
    const entry = path.join(workDir, "entry.ts");
    await writeFile(
      entry,
      'import { sdk, unwrap, GlyphError } from "@glyphs-ai/sdk";\n' +
        "export { sdk, unwrap, GlyphError };\n",
      "utf8",
    );

    await build({
      root: workDir,
      logLevel: "silent",
      resolve: { alias: { "@glyphs-ai/sdk": SDK_ENTRY } },
      build: {
        outDir,
        ssr: false,
        emptyOutDir: true,
        minify: false,
        lib: { entry, formats: ["es"], fileName: "bundle" },
      },
    });

    const emitted = (await readdir(outDir)).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
    expect(emitted.length).toBeGreaterThan(0);

    let bundle = "";
    for (const file of emitted) bundle += await readFile(path.join(outDir, file), "utf8");

    for (const [label, pattern] of NODE_LEAK_PATTERNS) {
      expect(
        pattern.test(bundle),
        `browser bundle leaked Node-only code (${label}) — the generated client must stay runtime-agnostic`,
      ).toBe(false);
    }
  });
});
