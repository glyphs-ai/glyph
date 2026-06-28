/**
 * Structural enforcement of the "test layout mirrors src layout"
 * convention documented in `docs/pkg-template.md § Test layout
 * convention`. Sibling to `split-convention.test.ts` (which enforces
 * the orthogonal facade + sibling-subdir rule on `src/`).
 *
 * Rule (from docs/pkg-template.md):
 *
 *   For every `packages/<pkg>/test/**\/*.test.{ts,tsx}` file, collect
 *   all non-type value-imports that resolve to a file under the same
 *   package's `src/` tree (resolve the relative specifier against the
 *   test file's directory; ignore type-only imports, `vi.mock(...)`,
 *   `vi.importActual(...)`, and imports of any other workspace
 *   package or node builtin).
 *
 *     1. Set is empty → flat at `test/<name>.test.{ts,tsx}`
 *        (cross-cutting / e2e / fs-walk audits).
 *     2. Set is non-empty AND every import shares a common
 *        subdirectory under `src/` strictly deeper than `src/` itself
 *        → MUST live at `test/<that-subdir>/<name>.test.{ts,tsx}`.
 *     3. Otherwise (multiple imports with no common subdir below
 *        `src/`) → flat at `test/<name>.test.{ts,tsx}`.
 *
 * Type-only imports (`import type { Foo } from "..."` and the `type`
 * modifier inside mixed `import { type Foo, bar }` specifiers) compile
 * away and do NOT count. `vi.mock("...")` and `vi.importActual("...")`
 * are harness, not subject, and do NOT count. Side-effect-only
 * `import "x"` DOES count (it executes top-level code).
 *
 * Allowlist discipline:
 *   - `ALLOWED_FLAT_EXCEPTIONS` carries tests the rule would require
 *     to move but which have a documented reason to stay grouped by
 *     subject (multi-subdir composites, umbrella audits, harnesses).
 *   - Entries are sorted by file path (review hygiene).
 *   - Every entry must have a non-empty rationale string.
 *   - Stale entries (file no longer exists) fail.
 *   - Idle entries (rule already passes for this file) fail — stops
 *     the allowlist from accumulating defensive entries.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractImportRefs } from "../_helpers/ts-imports.js";
import { isTestFile, walkFiles } from "../_helpers/walk.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

interface FlatException {
  readonly file: string; // repo-relative, forward-slash
  readonly rationale: string; // why this test stays flat
}

/**
 * Tests whose actual location differs from the rule-derived required
 * location, with a documented reason to keep the divergence. Sorted
 * by file path. Every entry must carry a one-line rationale.
 *
 * Two flavours of entry:
 *
 *  1. **Flat test the rule says belongs in a subdir** — kept flat by
 *     intent (umbrella reflection tests, source-adjacent groups).
 *  2. **Subdir test the rule says belongs at flat** — kept in the
 *     subdir by intent (per-area layouts whose imports span multiple
 *     sibling subdirs of `src/`).
 *
 * Rule-compliant tests (actual === required) do NOT belong here — the
 * "no idle entries" check rejects them so the allowlist doesn't
 * accumulate defensive entries that protect against nothing.
 *
 * Rule-compliant files and stale subject groupings do not belong here.
 */
const ALLOWED_FLAT_EXCEPTIONS: readonly FlatException[] = [
  // _template
  {
    file: "packages/_template/test/application/__entity-kebab__.service.test.ts",
    rationale:
      "London-style mocked service test (scaffold exemplar); value-imports span application/ (service) + contract/ (error class for instanceof assertions). Kept in application/ to mirror the layered layout, same as workspace.",
  },
  // catalog
  {
    file: "packages/catalog/test/agent/agent-service.test.ts",
    rationale:
      "grouped by area (agent/); imports `safeNormalize` from src/fetcher/ to share the canonical file: key with the read seam under test — rule says flat. Per-area test stays grouped by subject.",
  },
  {
    file: "packages/catalog/test/facade/catalog-service.sync.test.ts",
    rationale:
      "grouped by area (facade/); imports span agent + skill + mcp sibling subdirs of src/ — rule says flat. Facade service coverage stays co-located by subject.",
  },
  {
    file: "packages/catalog/test/facade/catalog-service.test.ts",
    rationale:
      "grouped by area (facade/); imports span agent + skill + mcp sibling subdirs of src/ — rule says flat. Facade service coverage stays co-located by subject.",
  },
  {
    file: "packages/catalog/test/skill/skill-service.test.ts",
    rationale:
      "grouped by area (skill/); imports `safeNormalize` from src/fetcher/ to share the canonical file: key with the read seam under test — rule says flat. Per-area test stays grouped by subject.",
  },
  // cli
  // dashboard
  {
    file: "packages/dashboard/test/hooks/useWorkflowArtifacts.test.ts",
    rationale:
      "grouped by area (hooks/); imports span hooks/ + api sibling subdirs of src/ — rule says flat. Mirrors src/hooks/useWorkflowArtifacts.ts; co-location with the source aids editor navigation.",
  },
  {
    file: "packages/dashboard/test/hooks/useWorkflows.test.tsx",
    rationale:
      "grouped by area (hooks/); imports span hooks/ + api/ + components/tasks/ sibling subdirs of src/ — rule says flat. Mirrors src/hooks/useWorkflows.ts; co-location with the source aids editor navigation.",
  },
  {
    file: "packages/dashboard/test/pages/workflows/WorkflowView.test.tsx",
    rationale:
      "grouped by area (pages/workflows/); imports span pages/workflows/ + api sibling subdirs of src/ — rule says flat. Mirrors src/pages/workflows/WorkflowView.tsx; co-location with the source aids editor navigation.",
  },
  // e2e
  {
    file: "packages/e2e/test/architecture/inter-service-imports.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports — rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/architecture/schedule-substrate.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports, so the rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/architecture/sdk-no-server-runtime-import.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports — rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/architecture/split-convention.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports — rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/architecture/test-layout-convention.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports — rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/architecture/tier-invisibility.test.ts",
    rationale:
      "grouped by area (architecture/); zero in-pkg src value-imports — rule says flat. Cross-cutting repo-wide audits stay grouped with architecture siblings.",
  },
  {
    file: "packages/e2e/test/cli/bundle-smoke.test.ts",
    rationale:
      "grouped by area (cli/); zero in-pkg src value-imports, so the rule says flat. CLI spawn harnesses stay grouped by subject.",
  },
  {
    file: "packages/e2e/test/cli/help-surface.test.ts",
    rationale:
      "grouped by area (cli/); zero in-pkg src value-imports, so the rule says flat. CLI help-surface snapshot stays grouped by subject.",
  },
  {
    file: "packages/e2e/test/cli/integration-smoke.test.ts",
    rationale:
      "grouped by area (cli/); zero in-pkg src value-imports — rule says flat. CLI spawn harnesses stay grouped by subject.",
  },
  {
    file: "packages/e2e/test/cli/spawn-smoke.test.ts",
    rationale:
      "grouped by area (cli/); zero in-pkg src value-imports — rule says flat. CLI spawn harnesses stay grouped by subject.",
  },
  {
    file: "packages/e2e/test/wire-shape/response-bodies.test.ts",
    rationale:
      "grouped by area (wire-shape/); zero in-pkg src value-imports (contracts types are type-only), so the rule says flat. Wire-shape response-body checks stay grouped by subject.",
  },
  // runtime
  {
    file: "packages/runtime/test/copilot/copilot-runtime.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  {
    file: "packages/runtime/test/copilot/ids.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  {
    file: "packages/runtime/test/copilot/launch-headless-env.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  {
    file: "packages/runtime/test/copilot/preflight.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  {
    file: "packages/runtime/test/copilot/provision.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  {
    file: "packages/runtime/test/copilot/trust.test.ts",
    rationale:
      "grouped by runtime kind (copilot/); imports span copilot/ + sibling top-level src/ files — rule says flat. Runtime adapter coverage stays grouped by adapter.",
  },
  // server
  {
    file: "packages/server/test/openapi-snapshot.test.ts",
    rationale:
      "umbrella reflection test that mounts every route group to assemble the OpenAPI document. Imports happen to share subdir 'routes' but the test is the spec's umbrella, not a route subject — kept flat to mirror its scope.",
  },
  {
    file: "packages/server/test/routes/request-validation.test.ts",
    rationale:
      "grouped by area (routes/); workspace route factory now lives in @glyphs-ai/api so zero in-pkg src value-imports remain — rule says flat. Test validates the validation-hook behaviour of the route factory, grouped by transport concern.",
  },
  {
    file: "packages/server/test/workspaces.test.ts",
    rationale:
      "workspace route integration test; route factory migrated to @glyphs-ai/api so remaining in-pkg imports are middleware-only — rule says middleware/. Kept flat: subject is the workspace API surface, not the middleware.",
  },
  // terminal
  {
    file: "packages/terminal/test/platforms/linux.test.ts",
    rationale:
      "grouped by platform (platforms/); imports span platforms/ + sibling top-level src/ files — rule says flat. Platform coverage stays grouped by OS.",
  },
  {
    file: "packages/terminal/test/platforms/macos.test.ts",
    rationale:
      "grouped by platform (platforms/); imports span platforms/ + sibling top-level src/ files — rule says flat. Platform coverage stays grouped by OS.",
  },
  {
    file: "packages/terminal/test/platforms/windows.test.ts",
    rationale:
      "grouped by platform (platforms/); imports span platforms/ + sibling top-level src/ files — rule says flat. Platform coverage stays grouped by OS.",
  },
  // workspace
  {
    file: "packages/workspace/test/application/workspace.service.test.ts",
    rationale:
      "London-style mocked service test; value-imports span application/ (service) + contract/ (error classes for instanceof assertions). Placed in application/ per §16.2 layered layout.",
  },
];

/**
 * Extract every NON-TYPE value-import specifier from a TS source file.
 *
 * Includes:
 *  - `import { x } from "..."` — value bindings; counts.
 *  - `import x from "..."` — default value binding; counts.
 *  - `import * as ns from "..."` — namespace binding; counts.
 *  - `import "..."` — side-effect only; counts (executes top-level code).
 *  - `import { type X, y } from "..."` — counts because of `y`.
 *  - `import("...")` dynamic import — counts.
 *
 * Excludes:
 *  - `import type { X } from "..."` — fully type-only; does NOT count.
 *  - `import { type X } from "..."` where every specifier is `type` —
 *    does NOT count.
 *  - `type Y = import("X").Foo` (`ImportTypeNode`) — does NOT count.
 *  - `vi.mock("...")` / `vi.importActual("...")` / `vi.doMock(...)` /
 *    `vi.unmock(...)` — harness directives, do NOT count.
 *
 * Returns raw specifier strings — resolution is up to the caller.
 */
function extractValueImportSpecifiers(filePath: string): readonly string[] {
  const source = readFileSync(filePath, "utf8");
  return extractImportRefs(source, filePath)
    .filter((r) => r.kind !== "export-from" && r.isValueImport)
    .map((r) => r.specifier);
}

/**
 * Resolve a relative specifier against a test file's directory. Tries
 * the path verbatim, then with `.ts` / `.tsx` appended, then as
 * `<path>/index.ts` / `.tsx`. Returns abs path or null.
 *
 * Node-builtins (`node:fs` etc.) and workspace specifiers
 * (`@glyphs-ai/*`, bare names) return null without filesystem checks.
 */
function resolveSpecifier(testDir: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // bare / workspace / builtin
  // Drop a trailing `.js` and try `.ts` / `.tsx` (ESM extension rewrites
  // are how this monorepo imports `./foo.js` that maps to `./foo.ts`).
  const noJs = spec.endsWith(".js") ? spec.slice(0, -3) : spec;
  const candidates = [spec, `${noJs}.ts`, `${noJs}.tsx`, `${noJs}/index.ts`, `${noJs}/index.tsx`];
  for (const cand of candidates) {
    const abs = path.resolve(testDir, cand);
    try {
      const s = statSync(abs);
      if (s.isFile()) return abs;
    } catch {
      // try next
    }
  }
  return null;
}

/** Is abs path under `packages/<samePkg>/src/`? */
function isUnderPkgSrc(abs: string, pkgName: string): boolean {
  const pkgSrc = path.join(PACKAGES_DIR, pkgName, "src") + path.sep;
  return abs.startsWith(pkgSrc);
}

/**
 * Subdirectory of an in-pkg-src import, relative to the pkg's `src/`
 * root. Returns `""` for files immediately under `src/` (which the
 * rule treats as having no shared subdir → flat-required when alone).
 */
function srcSubdirOf(abs: string, pkgName: string): string {
  const pkgSrc = path.join(PACKAGES_DIR, pkgName, "src");
  const rel = path.relative(pkgSrc, path.dirname(abs));
  // path.relative returns "" if dir IS pkgSrc; or "<segments>" otherwise.
  // Normalise separators to "/" for stable comparison.
  return rel.split(path.sep).join("/");
}

/**
 * Longest common directory prefix across a list of subdir strings
 * (each "/"-separated). Returns "" if no shared prefix below the first
 * segment.
 *
 * Empty input is undefined; callers should not pass [].
 */
function longestCommonDir(dirs: readonly string[]): string {
  if (dirs.length === 0) return "";
  // If any subdir is empty (file directly under src/), the LCP can only
  // be empty.
  if (dirs.some((d) => d === "")) return "";
  const splitDirs = dirs.map((d) => d.split("/"));
  const first = splitDirs[0];
  if (first === undefined) return "";
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (splitDirs.every((d) => d[i] === seg)) {
      out.push(seg as string);
    } else {
      break;
    }
  }
  return out.join("/");
}

interface ClassifiedTest {
  readonly absPath: string;
  readonly relPath: string; // repo-relative, forward-slash
  readonly pkg: string;
  /** `"flat"` if directly under `packages/<pkg>/test/`; else the slash-joined subdir under `test/`. */
  readonly actualLocation: "flat" | string;
  /** `"flat"` per the rule, or the required slash-joined subdir under `test/`. */
  readonly requiredLocation: "flat" | string;
  readonly reason: string;
}

function classifyTest(absPath: string): ClassifiedTest {
  const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
  // packages/<pkg>/test/...
  const parts = relPath.split("/");
  const pkg = parts[1] ?? "";
  const insideTest = parts.slice(3); // after packages/<pkg>/test/
  const actualSub = insideTest.slice(0, -1).join("/");
  const actualLocation: "flat" | string = actualSub.length === 0 ? "flat" : actualSub;

  const testDir = path.dirname(absPath);
  const specs = extractValueImportSpecifiers(absPath);
  const inPkgSrcSubdirs: string[] = [];
  for (const spec of specs) {
    const resolved = resolveSpecifier(testDir, spec);
    if (resolved === null) continue;
    if (!isUnderPkgSrc(resolved, pkg)) continue;
    inPkgSrcSubdirs.push(srcSubdirOf(resolved, pkg));
  }

  let requiredLocation: "flat" | string;
  let reason: string;
  if (inPkgSrcSubdirs.length === 0) {
    requiredLocation = "flat";
    reason = "zero in-pkg src value-imports";
  } else {
    const lcp = longestCommonDir(inPkgSrcSubdirs);
    if (lcp.length === 0) {
      requiredLocation = "flat";
      reason = "in-pkg src value-imports share no common subdir below src/";
    } else {
      requiredLocation = lcp;
      reason = `every in-pkg src value-import shares subdir "${lcp}"`;
    }
  }

  return {
    absPath,
    relPath,
    pkg,
    actualLocation,
    requiredLocation,
    reason,
  };
}

function findAllTests(): readonly string[] {
  const out: string[] = [];
  // Walk each package's test/ dir.
  const pkgs = readdirSync(PACKAGES_DIR, { withFileTypes: true, encoding: "utf8" });
  for (const pkg of pkgs) {
    if (!pkg.isDirectory()) continue;
    const testRoot = path.join(PACKAGES_DIR, pkg.name, "test");
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(testRoot);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    for (const absFile of walkFiles(testRoot, { match: isTestFile })) {
      out.push(absFile);
    }
  }
  return out;
}

describe("test layout mirrors src layout", () => {
  const all = findAllTests().map(classifyTest);
  const allowedSet = new Set(ALLOWED_FLAT_EXCEPTIONS.map((e) => e.file));
  const selfRel = path
    .relative(REPO_ROOT, import.meta.filename)
    .split(path.sep)
    .join("/");

  it("every test file's required location matches its actual location (or is in ALLOWED_FLAT_EXCEPTIONS)", () => {
    const violations: string[] = [];
    for (const t of all) {
      if (t.actualLocation === t.requiredLocation) continue;
      if (allowedSet.has(t.relPath)) continue;
      violations.push(
        `${t.relPath}: actual=${t.actualLocation} required=${t.requiredLocation} (${t.reason}). ` +
          `Either move the file, or add it to ALLOWED_FLAT_EXCEPTIONS in ${selfRel} with a one-line rationale.`,
      );
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("ALLOWED_FLAT_EXCEPTIONS has no stale entries (every entry must exist on disk)", () => {
    const missing: string[] = [];
    for (const ex of ALLOWED_FLAT_EXCEPTIONS) {
      const abs = path.join(REPO_ROOT, ex.file);
      try {
        statSync(abs);
      } catch {
        missing.push(
          `${ex.file} — listed in ALLOWED_FLAT_EXCEPTIONS but does not exist on disk. Remove the entry.`,
        );
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("ALLOWED_FLAT_EXCEPTIONS has no idle entries (every entry must actually be required-to-move under the rule)", () => {
    // Stops the allowlist from accumulating defensive entries for
    // tests the rule doesn't even ding.
    const idle: string[] = [];
    const allMap = new Map(all.map((t) => [t.relPath, t]));
    for (const ex of ALLOWED_FLAT_EXCEPTIONS) {
      const t = allMap.get(ex.file);
      if (!t) continue; // covered by previous test
      if (t.actualLocation === t.requiredLocation) {
        idle.push(
          `${ex.file} — listed in ALLOWED_FLAT_EXCEPTIONS but the rule already passes (actual=${t.actualLocation}). Remove the entry.`,
        );
      }
    }
    expect(idle, idle.join("\n")).toEqual([]);
  });

  it("ALLOWED_FLAT_EXCEPTIONS entries are sorted by file path (review hygiene)", () => {
    const sorted = [...ALLOWED_FLAT_EXCEPTIONS].map((e) => e.file).sort();
    const actual = ALLOWED_FLAT_EXCEPTIONS.map((e) => e.file);
    expect(actual, "Sort ALLOWED_FLAT_EXCEPTIONS by file path. Use a stable sort.").toEqual(sorted);
  });

  it("ALLOWED_FLAT_EXCEPTIONS rationale is non-empty for every entry", () => {
    const empty = ALLOWED_FLAT_EXCEPTIONS.filter((e) => e.rationale.trim().length === 0).map(
      (e) => e.file,
    );
    expect(
      empty,
      `Empty rationale: ${empty.join(", ")}. Every allowlist entry needs a one-line explanation of why the rule's required move is wrong for this test.`,
    ).toEqual([]);
  });

  it("sanity: at least one test was classified as mirror-required (audit didn't silently no-op)", () => {
    const mirrorRequired = all.filter((t) => t.requiredLocation !== "flat");
    expect(mirrorRequired.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Parser self-tests — pin behaviour against hand-crafted source strings
// so a TS version bump doesn't silently change classification.
// ──────────────────────────────────────────────────────────────────────

function specifiersFromSource(source: string, kind: "ts" | "tsx" = "ts"): readonly string[] {
  const fileName = `virtual.${kind}`;
  return extractImportRefs(source, fileName)
    .filter((r) => r.kind !== "export-from" && r.isValueImport)
    .map((r) => r.specifier);
}

describe("test-layout-convention parser self-tests", () => {
  it("type-only imports are ignored", () => {
    expect(specifiersFromSource('import type { Foo } from "./x.js";')).toEqual([]);
  });

  it("mixed `{ type Foo, bar }` counts the import (value specifier `bar`)", () => {
    expect(specifiersFromSource('import { type Foo, bar } from "./x.js";')).toEqual(["./x.js"]);
  });

  it("mixed `{ type Foo }` alone (every specifier is type) does NOT count", () => {
    expect(specifiersFromSource('import { type Foo } from "./x.js";')).toEqual([]);
  });

  it('vi.mock("...") is ignored', () => {
    expect(
      specifiersFromSource(
        'import { vi } from "vitest";\nvi.mock("./mocked.js", () => ({ ok: true }));',
      ),
    ).toEqual(["vitest"]);
  });

  it('vi.importActual("...") is ignored', () => {
    expect(
      specifiersFromSource(
        'import { vi } from "vitest";\nvi.mock("./mocked.js", async () => ({\n' +
          '  ...(await vi.importActual("./mocked.js")),\n' +
          "}));",
      ),
    ).toEqual(["vitest"]);
  });

  it('dynamic import("...") counts as value', () => {
    expect(specifiersFromSource('const mod = await import("./dyn.js");')).toEqual(["./dyn.js"]);
  });

  it('side-effect-only `import "x"` counts as value', () => {
    expect(specifiersFromSource('import "./init.js";')).toEqual(["./init.js"]);
  });

  it('ImportTypeNode (`type Y = import("X").Foo`) is ignored', () => {
    expect(specifiersFromSource('type Y = import("./x.js").Foo;')).toEqual([]);
  });

  it("default + namespace bindings count as value", () => {
    expect(specifiersFromSource('import a from "./a.js";')).toEqual(["./a.js"]);
    expect(specifiersFromSource('import * as ns from "./ns.js";')).toEqual(["./ns.js"]);
  });

  it("bare specifiers (workspace pkgs, node builtins) do NOT resolve to in-pkg src — none counted as subjects", () => {
    // We DO list bare imports as specifiers (caller filters), so this
    // test pins behaviour at the resolver layer instead: passing them
    // through resolveSpecifier returns null.
    expect(resolveSpecifier("/tmp", "@glyphs-ai/catalog")).toBeNull();
    expect(resolveSpecifier("/tmp", "node:fs")).toBeNull();
    expect(resolveSpecifier("/tmp", "vitest")).toBeNull();
  });

  it("longestCommonDir handles single, multiple, and disjoint cases", () => {
    expect(longestCommonDir(["api"])).toBe("api");
    expect(longestCommonDir(["api/a", "api/b"])).toBe("api");
    expect(longestCommonDir(["api/a", "api/a/b"])).toBe("api/a");
    expect(longestCommonDir(["api/a", "pages/b"])).toBe("");
    expect(longestCommonDir(["components/foo", ""])).toBe("");
    expect(longestCommonDir(["components/x", "components"])).toBe("components");
  });
});
