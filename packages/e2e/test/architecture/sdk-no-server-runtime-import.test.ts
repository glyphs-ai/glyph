/**
 * `@glyphs-ai/sdk` must be self-contained at runtime. Its `src/**` tree —
 * the hand-written public surface plus the committed `@hey-api/openapi-ts`
 * output under `src/generated/` — may NOT reference ANY `@glyphs-ai/*`
 * workspace package, not even type-only. The generated fetch client inlines
 * its own runtime, so the published package ships zero `@glyphs-ai/*` edges
 * and stays safe to drop into the dashboard's browser bundle.
 *
 * `packages/sdk/scripts/**` is intentionally OUT OF SCOPE: the codegen
 * pipeline (`generate.ts` + `build-openapi-app.ts`) is devtime-only tooling
 * that legitimately imports `@glyphs-ai/server` (and the services it mounts)
 * to assemble the spec in-process. That edge never ships in `dist/`.
 *
 * Sibling to `inter-service-imports.test.ts` and `tier-invisibility.test.ts`;
 * uses the same shared AST extractor so specifiers mentioned only in
 * comments or string literals are never matched.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractImportRefs } from "../_helpers/ts-imports.js";
import { isTsFile, safeIsDir, walkFiles } from "../_helpers/walk.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const SDK_SRC = path.join(REPO_ROOT, "packages", "sdk", "src");

function relPosix(absFile: string): string {
  return path.relative(REPO_ROOT, absFile).split(path.sep).join("/");
}

interface Offender {
  readonly file: string;
  readonly specifier: string;
}

function collectGlyphReferences(): Offender[] {
  const out: Offender[] = [];
  if (!safeIsDir(SDK_SRC)) return out;
  for (const absFile of walkFiles(SDK_SRC, { match: isTsFile })) {
    const source = readFileSync(absFile, "utf8");
    for (const ref of extractImportRefs(source, absFile)) {
      if (/^@glyphs-ai\//.test(ref.specifier)) {
        out.push({ file: relPosix(absFile), specifier: ref.specifier });
      }
    }
  }
  return out;
}

describe("@glyphs-ai/sdk src/** is free of @glyphs-ai/* imports", () => {
  it("references no @glyphs-ai/* package (value or type) anywhere under src/", () => {
    const offenders = collectGlyphReferences();
    expect(
      offenders,
      `packages/sdk/src/** must not reference any @glyphs-ai/* package (value OR type). Found ${offenders.length}:\n${offenders
        .map((o) => `  ${o.file} → ${o.specifier}`)
        .join(
          "\n",
        )}\n\nThe SDK ships a self-contained generated client. Codegen tooling that needs server source belongs under packages/sdk/scripts/ (out of scope).`,
    ).toEqual([]);
  });

  it("actually scanned the sdk src tree (guards against a path typo)", () => {
    let scanned = 0;
    for (const _ of walkFiles(SDK_SRC, { match: isTsFile })) {
      scanned++;
      if (scanned > 0) break;
    }
    expect(scanned).toBeGreaterThan(0);
  });
});
