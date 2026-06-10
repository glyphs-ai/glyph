/**
 * Structural enforcement of the top-level app-consumer fence.
 *
 * Pins the canonical tier-visibility decision from `docs/architecture.md`:
 * `@glyphs-ai/dashboard` and `@glyphs-ai/cli` may only see T0/T1
 * packages through `@glyphs-ai/contracts`. The documented exception is
 * the bundled server edge: the `glyph` binary includes the server boot
 * and lifecycle path, so `@glyphs-ai/cli` may reference
 * `@glyphs-ai/server`.
 *
 * Canonical package tiers:
 *   - T0 Foundations: workspace, runtime, schedule, terminal, catalog
 *   - T1 Modes: session, task, workflow
 *   - T2 Application: contracts, api
 *   - T3 Host: server
 *   - T_top Surfaces: dashboard, cli
 *
 * `workflow` is a T1 execution mode alongside `task` and `session`;
 * top-level apps consume workflow data through contracts and server
 * routes rather than importing `@glyphs-ai/workflow` directly.
 *
 * The rule applies at two layers:
 *
 *   1. SOURCE: every `import` / `export ... from` specifier of the form
 *      `@glyphs-ai/<pkg>` in `packages/{dashboard,cli}/{src,test}/**` must
 *      be in the per-consumer allowlist.
 *
 *   2. MANIFEST: every `workspace:*` entry in `dashboard/package.json`
 *      and `cli/package.json` (dependencies + devDependencies) that
 *      starts with `@glyphs-ai/` must be in the per-consumer allowlist.
 *      Catches "the import has been removed but the dep is still
 *      declared in package.json" drift in the opposite direction —
 *      the structural fence is meaningless if pnpm still hoists the
 *      orchestration pkg into the consumer's `node_modules` because
 *      a dangling dep stayed behind.
 *
 * Allowlists (per consumer):
 *
 *   dashboard: { "@glyphs-ai/contracts" }
 *     Browser code must stay on wire contracts. Orchestration
 *     value-imports (CatalogService, the composeApplication factory,
 *     db handles) would be runtime nonsense; even type-imports from
 *     `@glyphs-ai/api` would couple the dashboard's static module
 *     graph to Node-only modules, defeating the whole point of having
 *     a separate wire-types pkg.
 *
 *   cli:       { "@glyphs-ai/contracts", "@glyphs-ai/server" }
 *     The `glyph` binary bundles both the client CLI and the server
 *     lifecycle path. `@glyphs-ai/server` owns the in-process boot
 *     entry plus server runtime-file helpers, so this package-level
 *     edge is legitimate while every T0/T1 package remains fenced.
 *
 * Hosting: lives in `@glyphs-ai/e2e/test/architecture/` alongside the
 * other repo-wide architectural audits (`inter-service-imports`,
 * `split-convention`, `test-layout-convention`). The audit is
 * repo-wide and walks `packages/{dashboard,cli}/{src,test}/**` —
 * the fenced consumers it polices.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "drizzle"]);
const T0_PKGS = ["workspace", "runtime", "schedule", "terminal", "catalog"] as const;
const T1_PKGS = ["session", "task", "workflow"] as const;
const T2_PKGS = ["contracts", "api"] as const;
const T3_PKGS = ["server"] as const;
const T_TOP_PKGS = ["dashboard", "cli"] as const;
const TIER_SUMMARY = [
  `T0={${T0_PKGS.join(", ")}}`,
  `T1={${T1_PKGS.join(", ")}}`,
  `T2={${T2_PKGS.join(", ")}}`,
  `T3={${T3_PKGS.join(", ")}}`,
  `T_top={${T_TOP_PKGS.join(", ")}}`,
].join("; ");

interface Consumer {
  /** Pkg name under `packages/`. */
  readonly pkg: string;
  /** Set of `@glyphs-ai/*` specifiers the consumer is allowed to reference. */
  readonly allowed: ReadonlySet<string>;
}

const CONSUMERS: readonly Consumer[] = [
  {
    pkg: "dashboard",
    allowed: new Set(["@glyphs-ai/contracts"]),
  },
  {
    pkg: "cli",
    allowed: new Set(["@glyphs-ai/contracts", "@glyphs-ai/server"]),
  },
];

interface SourceViolation {
  /** Repo-relative, forward-slash path. */
  readonly file: string;
  readonly specifier: string;
}

interface ManifestViolation {
  readonly consumer: string;
  readonly specifier: string;
  /** Which section it appeared in: `dependencies` or `devDependencies`. */
  readonly section: "dependencies" | "devDependencies";
}

// ── helpers ────────────────────────────────────────────────────────────

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function* walkTsFiles(dir: string): Generator<string> {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      yield* walkTsFiles(path.join(dir, e.name));
    } else if (e.isFile()) {
      if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
        yield path.join(dir, e.name);
      }
    }
  }
}

function relPosix(absFile: string): string {
  return path.relative(REPO_ROOT, absFile).split(path.sep).join("/");
}

/**
 * Extract every `@glyphs-ai/*` specifier referenced by a TS / TSX file:
 *   - `import ... from "@glyphs-ai/x"` (value or type)
 *   - `export ... from "@glyphs-ai/x"` (re-export)
 *   - dynamic `import("@glyphs-ai/x")` calls
 *
 * Uses a regex scan (not a full TS parse) deliberately — the rule is
 * "specifier text matches `@glyphs-ai/*`", and the same regex catches
 * value and type imports alike. Avoiding the TS API keeps this test
 * an order of magnitude cheaper than `inter-service-imports.test.ts`,
 * which needs AST classification (value vs type) that this audit
 * does not care about.
 *
 * False-positive scope: a comment or string containing a specifier-shaped
 * code example such as `from "@glyphs-ai/x"` or `import("@glyphs-ai/x")`
 * would also match. The audit filters self-references (a pkg mentioning
 * its own name in its own source is at worst a circular-import bug, but
 * it cannot be a fence break — see `collectSourceViolations`); other
 * cross-pkg specifier-shaped mentions are surfaced for review.
 * Over-cautious for now is better than missing real fence breaks.
 */
function extractGlyphSpecifiers(source: string): string[] {
  const re = /(?:from|import)\s*\(?\s*["'](@glyphs-ai\/[A-Za-z0-9_-]+)["']/g;
  const out: string[] = [];
  for (const match of source.matchAll(re)) {
    out.push(match[1] as string);
  }
  return out;
}

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readManifest(pkg: string): Manifest {
  const abs = path.join(PACKAGES_DIR, pkg, "package.json");
  return JSON.parse(readFileSync(abs, "utf8")) as Manifest;
}

function collectSourceViolations(consumer: Consumer): SourceViolation[] {
  const selfSpec = `@glyphs-ai/${consumer.pkg}`;
  const out: SourceViolation[] = [];
  for (const subdir of ["src", "test"] as const) {
    const root = path.join(PACKAGES_DIR, consumer.pkg, subdir);
    if (!safeIsDir(root)) continue;
    for (const absFile of walkTsFiles(root)) {
      const source = readFileSync(absFile, "utf8");
      for (const spec of extractGlyphSpecifiers(source)) {
        if (spec === selfSpec) continue;
        if (consumer.allowed.has(spec)) continue;
        out.push({ file: relPosix(absFile), specifier: spec });
      }
    }
  }
  return out;
}

function collectManifestViolations(consumer: Consumer): ManifestViolation[] {
  const m = readManifest(consumer.pkg);
  const out: ManifestViolation[] = [];
  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = m[section];
    if (!deps) continue;
    for (const [name] of Object.entries(deps)) {
      if (!name.startsWith("@glyphs-ai/")) continue;
      if (consumer.allowed.has(name)) continue;
      out.push({ consumer: consumer.pkg, specifier: name, section });
    }
  }
  return out;
}

// ── audits ─────────────────────────────────────────────────────────────

describe("tier-invisibility specifier parser", () => {
  it("extracts @glyphs-ai import, export, and dynamic-import specifiers", () => {
    const specs = extractGlyphSpecifiers(`
      import { ROUTES } from "@glyphs-ai/contracts";
      export { runServer } from "@glyphs-ai/server";
      const server = await import("@glyphs-ai/server");
      const label = "@glyphs-ai/catalog";
    `);
    expect(specs).toEqual(["@glyphs-ai/contracts", "@glyphs-ai/server", "@glyphs-ai/server"]);
  });
});

describe("tier-invisibility: app consumers see only their allowlisted surfaces", () => {
  for (const consumer of CONSUMERS) {
    const allowedList = [...consumer.allowed].sort().join(", ");

    it(`${consumer.pkg} src/** + test/** only reference {${allowedList}}`, () => {
      const violations = collectSourceViolations(consumer);
      const msg =
        violations.length === 0
          ? "(none)"
          : violations.map((v) => `  ${v.file} → ${v.specifier}`).join("\n");
      expect(
        violations,
        `Found ${violations.length} disallowed @glyphs-ai/* reference(s) in packages/${consumer.pkg}:\n${msg}\n\nCanonical tiers: ${TIER_SUMMARY}.\nAllowed: {${allowedList}}.\nRewire through the allowed surface, or — if introducing a new legitimate edge — update the CONSUMERS allowlist in this file and document the rationale in the top-of-file docstring.`,
      ).toEqual([]);
    });

    it(`${consumer.pkg}/package.json workspace deps ⊆ {${allowedList}}`, () => {
      const violations = collectManifestViolations(consumer);
      const msg =
        violations.length === 0
          ? "(none)"
          : violations.map((v) => `  ${v.section}: ${v.specifier}`).join("\n");
      expect(
        violations,
        `Found ${violations.length} disallowed @glyphs-ai/* dep(s) in packages/${consumer.pkg}/package.json:\n${msg}\n\nCanonical tiers: ${TIER_SUMMARY}.\nAllowed: {${allowedList}}. Remove the dep declaration (no source file imports it, per the source audit above) — leaving it behind defeats the structural fence because pnpm still hoists the pkg into node_modules and a future contributor can re-import it without the audit catching it until the next run.`,
      ).toEqual([]);
    });
  }
});
