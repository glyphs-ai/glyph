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
 *   - T2 Application: contracts, api, sdk
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
 *   cli:       { "@glyphs-ai/contracts", "@glyphs-ai/sdk", "@glyphs-ai/server" }
 *     The `glyph` binary bundles both the client CLI and the server
 *     lifecycle path. `@glyphs-ai/sdk` is the generated, typed HTTP
 *     client (T2 Application) the CLI uses for every server call — a
 *     downward T_top → T2 edge alongside `@glyphs-ai/contracts`, which
 *     still owns the wire DTOs the SDK and CLI exchange. `@glyphs-ai/server`
 *     owns the in-process boot entry plus server runtime-file helpers, so
 *     that package-level edge is legitimate too while every T0/T1 package
 *     remains fenced.
 *
 * Hosting: lives in `@glyphs-ai/e2e/test/architecture/` alongside the
 * other repo-wide architectural audits (`inter-service-imports`,
 * `split-convention`, `test-layout-convention`). The audit is
 * repo-wide and walks `packages/{dashboard,cli}/{src,test}/**` —
 * the fenced consumers it polices.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractImportRefs } from "../_helpers/ts-imports.js";
import { isTsFile, safeIsDir, walkFiles } from "../_helpers/walk.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const ARCHITECTURE_DOC = path.join(REPO_ROOT, "docs", "architecture.md");
// Real packages that are deliberately outside the tier model: the scaffold
// template and this cross-cutting e2e harness.
const NON_TIERED_PKGS = new Set(["_template", "e2e"]);
const T0_PKGS = ["workspace", "runtime", "schedule", "terminal", "catalog"] as const;
const T1_PKGS = ["session", "task", "workflow"] as const;
const T2_PKGS = ["contracts", "api", "sdk"] as const;
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
    allowed: new Set(["@glyphs-ai/contracts", "@glyphs-ai/sdk", "@glyphs-ai/server"]),
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

function relPosix(absFile: string): string {
  return path.relative(REPO_ROOT, absFile).split(path.sep).join("/");
}

/**
 * Extract every `@glyphs-ai/*` package specifier referenced by a TS /
 * TSX file, normalised to its package root:
 *   - `import ... from "@glyphs-ai/x"` (value or type),
 *   - `export ... from "@glyphs-ai/x"` (re-export),
 *   - dynamic `import("@glyphs-ai/x")` calls.
 *
 * Subpath specifiers (`@glyphs-ai/contracts/routes`) collapse to their
 * package root (`@glyphs-ai/contracts`) so the fence check compares
 * against package names. Uses the shared AST extractor, so a specifier
 * mentioned only inside a comment or string literal is never matched.
 */
function glyphPkgRoot(specifier: string): string | null {
  const match = specifier.match(/^(@glyphs-ai\/[A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function extractGlyphSpecifiers(source: string, fileName: string): string[] {
  const out: string[] = [];
  for (const ref of extractImportRefs(source, fileName)) {
    const root = glyphPkgRoot(ref.specifier);
    if (root !== null) out.push(root);
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
    for (const absFile of walkFiles(root, { match: isTsFile })) {
      const source = readFileSync(absFile, "utf8");
      for (const spec of extractGlyphSpecifiers(source, absFile)) {
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
  it("root-normalizes import, export, and dynamic specifiers and ignores comments + strings", () => {
    const specs = extractGlyphSpecifiers(
      `
      import { ROUTES } from "@glyphs-ai/contracts";
      import type { Plan } from "@glyphs-ai/contracts/routes";
      export { runServer } from "@glyphs-ai/server";
      const server = await import("@glyphs-ai/server");
      const label = "@glyphs-ai/catalog";
      // import { Hidden } from "@glyphs-ai/workflow";
    `,
      "sample.ts",
    );
    expect(specs).toEqual([
      "@glyphs-ai/contracts",
      "@glyphs-ai/contracts",
      "@glyphs-ai/server",
      "@glyphs-ai/server",
    ]);
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

/**
 * Parse the canonical tier table from docs/architecture.md. Each tier
 * row has the shape:
 *
 *   | **T0** | Foundations | `catalog`, `runtime`, ... | ...role... |
 *
 * Returns a map from tier label (`T0`..`T_top`) to the set of backticked
 * package names in its "Packages" column. Parenthetical annotations in
 * that column (e.g. `contracts` (wire types)) are not backticked and so
 * are naturally excluded.
 */
function parseDocTierTable(): Map<string, Set<string>> {
  const md = readFileSync(ARCHITECTURE_DOC, "utf8");
  const out = new Map<string, Set<string>>();
  const rowRe = /^\|\s*\*\*(T0|T1|T2|T3|T_top)\*\*\s*\|/;
  for (const line of md.split("\n")) {
    const m = rowRe.exec(line);
    if (m === null) continue;
    const tier = m[1];
    if (tier === undefined) continue;
    // cells[0] is the empty pre-pipe field; [1]=tier, [2]=name, [3]=packages.
    const pkgCell = line.split("|")[3] ?? "";
    const pkgs = new Set<string>();
    for (const tok of pkgCell.matchAll(/`([^`]+)`/g)) {
      const name = tok[1];
      if (name !== undefined) pkgs.add(name);
    }
    out.set(tier, pkgs);
  }
  return out;
}

// The single source of truth for "which package sits in which tier" is
// docs/architecture.md. These two cases keep the in-test tier constants
// (used by the fence above) honest against that doc AND against the real
// packages/ directory, so neither a doc edit nor a new package can drift
// the registry silently.
describe("tier registry stays in lockstep with docs/architecture.md", () => {
  const TEST_TIERS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["T0", T0_PKGS],
    ["T1", T1_PKGS],
    ["T2", T2_PKGS],
    ["T3", T3_PKGS],
    ["T_top", T_TOP_PKGS],
  ];

  it("each tier's package set matches the documented tier table", () => {
    const doc = parseDocTierTable();
    for (const [tier, pkgs] of TEST_TIERS) {
      const documented = doc.get(tier);
      expect(documented, `docs/architecture.md has no ${tier} tier row`).toBeDefined();
      expect(
        documented,
        `${tier} packages drift between docs/architecture.md and tier-invisibility.test.ts. ${TIER_SUMMARY}`,
      ).toEqual(new Set(pkgs));
    }
  });

  it("every package under packages/ is slotted into exactly one tier", () => {
    const onDisk = readdirSync(PACKAGES_DIR, { withFileTypes: true, encoding: "utf8" })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !NON_TIERED_PKGS.has(n));
    const assigned = TEST_TIERS.flatMap(([, pkgs]) => [...pkgs]);
    expect(assigned.length, "a package is listed under more than one tier").toBe(
      new Set(assigned).size,
    );
    expect(
      new Set(onDisk),
      `packages/ and the tier registry disagree (excluding ${[...NON_TIERED_PKGS].join(", ")}). ${TIER_SUMMARY}`,
    ).toEqual(new Set(assigned));
  });
});
