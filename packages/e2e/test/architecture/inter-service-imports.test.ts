/**
 * Structural enforcement of the "T0/T1 packages only type-import from
 * sibling T0/T1 packages" rule documented in `docs/pkg-template.md §
 * Type placement convention` (decision rule #4). Sibling to
 * `test-layout-convention.test.ts` (which audits test-file location)
 * and `tier-invisibility.test.ts` (which audits top-level consumer fences).
 *
 * Rule (from docs/pkg-template.md § decision rule 4):
 *
 *   For every TS/TSX source under `packages/<src-pkg>/src/**` where
 *   <src-pkg> is one of the T0/T1 bounded-context packages:
 *     T0: workspace, runtime, schedule, terminal, catalog
 *     T1: session, task, workflow
 *   `workflow` is a T1 execution mode alongside `task` and `session`.
 *
 *     Every `import` from `"@glyphs-ai/<other-t0-or-t1-pkg>"` MUST be
 *     type-only — either `import type { ... }`, or a mixed
 *     `import { type X, type Y }` with EVERY specifier carrying the
 *     `type` modifier, or `import type * as Ns`.
 *
 *   Value imports — default, named without `type`, namespace, or
 *   side-effect-only — are FORBIDDEN.
 *
 * Test files (`packages/<pkg>/test/**`) are OUT OF SCOPE: integration
 * tests legitimately need live sibling instances to compose end-to-end
 * scenarios. This audit targets production code (and its non-test
 * fixtures) only.
 *
 * Importing from `@glyphs-ai/api`,
 * `@glyphs-ai/dev-conventions`, `@glyphs-ai/server`, `@glyphs-ai/cli`,
 * `@glyphs-ai/dashboard`, or any other non-T0/T1 pkg is OUT OF SCOPE
 * — the rule constrains only the closed set of bounded-context pkgs.
 *
 * Why the rule: `@glyphs-ai/api` is the sole composition root that
 * value-imports T0/T1 services. Any other T0/T1-to-T0/T1 value-import
 * creates a runtime cross-BC dependency that bypasses the per-workspace
 * wiring discipline (see `docs/architecture.md`).
 *
 * Re-exports (`export { Foo } from "@glyphs-ai/catalog"`) are NOT
 * audited in this v1 — the convention is to not re-export across
 * bounded-context pkgs in the first place, and cross-pkg re-exports are
 * vanishingly rare in this repo. Promote to an audited rule if the
 * pattern ever appears.
 *
 * Allowlist discipline: `ALLOWED_VIOLATIONS` is the set of documented
 * exceptions to decision rule #4. It is empty — T0/T1 packages have no
 * accepted cross-BC value imports — so the audit pins it as empty with a
 * single guard rather than running sort / rationale / stale / idle
 * checks over a zero-length list. The canonical discipline checks for a
 * populated allowlist live in `test-layout-convention.test.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractImportRefs, type ImportRef } from "../_helpers/ts-imports.js";
import { isTsFile, safeIsDir, walkFiles } from "../_helpers/walk.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/**
 * Closed set of domain (bounded-context) pkgs. Any import where the
 * imported specifier is `@glyphs-ai/<one-of-these>` is in scope; every
 * other `@glyphs-ai/*` specifier (api, server, cli, dashboard, etc.)
 * is out of scope.
 */
const T0_PKGS = ["workspace", "runtime", "schedule", "terminal", "catalog"] as const;
const T1_PKGS = ["session", "task", "workflow"] as const;
const DOMAIN_PKGS: readonly string[] = [...T0_PKGS, ...T1_PKGS];
const DOMAIN_PKG_SET = new Set(DOMAIN_PKGS);

function domainPkgFromSpecifier(specifier: string): string | null {
  const match = specifier.match(/^@glyphs-ai\/([^/]+)$/);
  return match?.[1] ?? null;
}

interface Violation {
  /** Repo-relative path with forward-slash separators. */
  readonly file: string;
  /** The imported T0/T1 pkg name (without `@glyphs-ai/` prefix). */
  readonly importedPkg: string;
  /** Why this value-import is acceptable; required and non-empty. */
  readonly rationale: string;
}

/**
 * Documented exceptions to decision rule #4. Each entry pins a single
 * (file, importedPkg) pair that the audit would otherwise flag, with
 * a non-empty rationale.
 *
 * Currently empty: T0/T1 packages have no accepted cross-BC value
 * imports. Task and session resolve agents through local ports such as
 * `AgentResolverPort.getAgentEntry(...)`; the stricter no-catalog-imports
 * assertion below keeps those catalog edges fully absent.
 */
const ALLOWED_VIOLATIONS: readonly Violation[] = [];

// ── helpers ────────────────────────────────────────────────────────────

/** Repo-relative, forward-slash path. */
function relPosix(absFile: string): string {
  return path.relative(REPO_ROOT, absFile).split(path.sep).join("/");
}

/**
 * Walk every T0/T1 pkg's `src/` tree and collect every cross-BC
 * value-import. Returns the raw set; allowlist filtering is applied
 * by the test bodies that want unexcused violations.
 */
function collectAllCrossDomainValueImports(): readonly Violation[] {
  const out: Violation[] = [];
  for (const dom of DOMAIN_PKGS) {
    const srcDir = path.join(PACKAGES_DIR, dom, "src");
    if (!safeIsDir(srcDir)) continue;
    for (const absFile of walkFiles(srcDir, { match: isTsFile })) {
      const source = readFileSync(absFile, "utf8");
      const imports = extractImportRefs(source, absFile).filter((r) => r.kind !== "export-from");
      for (const imp of imports) {
        const importedPkg = domainPkgFromSpecifier(imp.specifier);
        if (importedPkg === null) continue;
        if (importedPkg === dom) continue;
        if (!DOMAIN_PKG_SET.has(importedPkg)) continue;
        if (!imp.isValueImport) continue;
        out.push({
          file: relPosix(absFile),
          importedPkg,
          rationale: "",
        });
      }
    }
  }
  return out;
}

function formatViolations(vs: readonly Violation[]): string {
  if (vs.length === 0) return "(no violations)";
  return vs
    .map(
      (v) =>
        `${v.file} → @glyphs-ai/${v.importedPkg} (value import; decision rule #4 of docs/pkg-template.md § Type placement convention)`,
    )
    .join("\n");
}

// ── audit ──────────────────────────────────────────────────────────────

describe("inter-service value-imports are forbidden", () => {
  const all = collectAllCrossDomainValueImports();
  const allowedKeys = new Set(
    ALLOWED_VIOLATIONS.map((a) => `${a.file}::@glyphs-ai/${a.importedPkg}`),
  );

  it("every T0/T1 src/** file type-imports sibling T0/T1 pkgs only (or is in ALLOWED_VIOLATIONS)", () => {
    const unexcused = all.filter((v) => !allowedKeys.has(`${v.file}::@glyphs-ai/${v.importedPkg}`));
    expect(
      unexcused,
      `Found ${unexcused.length} T0/T1 cross-BC value-import(s) that violate decision rule #4:\n${formatViolations(unexcused)}\n\nEither (a) convert the import to type-only (\`import type { ... }\` or per-specifier \`type\` modifiers), (b) thread the live instance through @glyphs-ai/api (the only legitimate value-importer), or (c) add an ALLOWED_VIOLATIONS entry with a non-empty rationale.`,
    ).toEqual([]);
  });

  it("ALLOWED_VIOLATIONS is intentionally empty (no documented cross-BC value-import exceptions)", () => {
    // The codebase has zero excused cross-domain value imports, so the
    // sort / rationale / stale / idle discipline a populated allowlist
    // needs would run over a zero-length list. Pin the invariant
    // directly instead; test-layout-convention.test.ts keeps the
    // canonical discipline checks for its populated allowlist.
    expect(ALLOWED_VIOLATIONS).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Strict no-catalog-imports rule for the task and session src trees.
// Strictly stronger than decision rule #4 above: forbids ALL `@glyphs-ai/catalog`
// references — value imports, type imports, namespace imports,
// re-exports, side-effect imports, and `import("@glyphs-ai/catalog")`
// type nodes alike. Pins the structural decoupling between catalog and
// task/session: task + session consume catalog only via the
// `AgentResolverPort` / `AgentContentSource` ports that the
// composition root (`@glyphs-ai/api`) supplies; the catalog package
// must never appear in either tree's source again. Future PRs that
// accidentally reintroduce a catalog import will fail this assertion.
// ──────────────────────────────────────────────────────────────────────

/**
 * Count every reference to `@glyphs-ai/catalog` reachable from a TS
 * source file: import declarations (regardless of value/type-only),
 * export-from declarations, and `import("@glyphs-ai/catalog")` type
 * nodes. Comments + string literals are excluded automatically by
 * the AST walk.
 */
function countCatalogReferences(source: string, fileName: string): number {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@glyphs-ai/catalog"
    ) {
      count++;
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@glyphs-ai/catalog"
    ) {
      count++;
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text === "@glyphs-ai/catalog"
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

describe("task and session src/** has zero @glyphs-ai/catalog references (structural decoupling)", () => {
  for (const dom of ["task", "session"] as const) {
    it(`packages/${dom}/src/** never references "@glyphs-ai/catalog"`, () => {
      const srcDir = path.join(PACKAGES_DIR, dom, "src");
      const offenders: { file: string; count: number }[] = [];
      if (safeIsDir(srcDir)) {
        for (const absFile of walkFiles(srcDir, { match: isTsFile })) {
          const source = readFileSync(absFile, "utf8");
          const n = countCatalogReferences(source, absFile);
          if (n > 0) offenders.push({ file: relPosix(absFile), count: n });
        }
      }
      expect(
        offenders,
        `Found ${offenders.length} file(s) under packages/${dom}/src/** that reference @glyphs-ai/catalog:\n${offenders.map((o) => `  ${o.file} (${o.count} reference${o.count === 1 ? "" : "s"})`).join("\n")}\n\nThe structural decoupling rule keeps @glyphs-ai/${dom} from importing @glyphs-ai/catalog directly. Pass a value satisfying the local AgentResolverPort + AgentContentSource at compose time instead.`,
      ).toEqual([]);
    });
  }
});

describe("inter-service-imports parser self-tests", () => {
  function classify(src: string): readonly ImportRef[] {
    return extractImportRefs(src, "virtual.ts").filter((r) => r.kind !== "export-from");
  }

  it("parses root @glyphs-ai package specifiers", () => {
    expect(domainPkgFromSpecifier("@glyphs-ai/catalog")).toBe("catalog");
    expect(domainPkgFromSpecifier("@glyphs-ai/workflow")).toBe("workflow");
    expect(domainPkgFromSpecifier("@glyphs-ai/catalog/testing")).toBeNull();
    expect(domainPkgFromSpecifier("@example/catalog")).toBeNull();
  });

  it('`import type { Foo } from "@glyphs-ai/catalog"` is type-only', () => {
    const cs = classify('import type { Foo } from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(false);
  });

  it('`import type * as Ns from "@glyphs-ai/catalog"` is type-only', () => {
    const cs = classify('import type * as Ns from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(false);
  });

  it('`import { type Foo, type Bar } from "@glyphs-ai/catalog"` is type-only (mixed all-type)', () => {
    const cs = classify('import { type Foo, type Bar } from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(false);
  });

  it('`import { type Foo, Bar } from "@glyphs-ai/catalog"` is a value import (mixed)', () => {
    const cs = classify('import { type Foo, Bar } from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });

  it('`import { type Foo, Bar as Aliased } from "@glyphs-ai/catalog"` is a value import', () => {
    const cs = classify('import { type Foo, Bar as Aliased } from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });

  it('`import Foo from "@glyphs-ai/catalog"` (default) is a value import', () => {
    const cs = classify('import Foo from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });

  it('`import * as Ns from "@glyphs-ai/catalog"` (namespace value) is a value import', () => {
    const cs = classify('import * as Ns from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });

  it('`import "@glyphs-ai/catalog"` (side-effect only) is a value import', () => {
    const cs = classify('import "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });

  it('`import { Foo } from "@glyphs-ai/catalog"` (plain named, no type modifier) is a value import', () => {
    const cs = classify('import { Foo } from "@glyphs-ai/catalog";');
    expect(cs).toHaveLength(1);
    expect(cs[0]?.isValueImport).toBe(true);
  });
});

describe("countCatalogReferences self-tests", () => {
  function count(src: string): number {
    return countCatalogReferences(src, "virtual.ts");
  }

  it("counts a plain value import", () => {
    expect(count('import { Foo } from "@glyphs-ai/catalog";')).toBe(1);
  });

  it("counts a type-only import", () => {
    expect(count('import type { Foo } from "@glyphs-ai/catalog";')).toBe(1);
  });

  it("counts a per-specifier type-only import (mixed all-type)", () => {
    expect(count('import { type Foo, type Bar } from "@glyphs-ai/catalog";')).toBe(1);
  });

  it("counts a namespace import", () => {
    expect(count('import * as Ns from "@glyphs-ai/catalog";')).toBe(1);
  });

  it("counts a side-effect-only import", () => {
    expect(count('import "@glyphs-ai/catalog";')).toBe(1);
  });

  it("counts a re-export", () => {
    expect(count('export { Foo } from "@glyphs-ai/catalog";')).toBe(1);
  });

  it('counts an `import("@glyphs-ai/catalog")` type node', () => {
    expect(count('type X = import("@glyphs-ai/catalog").Foo;')).toBe(1);
  });

  it("ignores comments that mention @glyphs-ai/catalog", () => {
    expect(count("// @glyphs-ai/catalog mentioned in a comment\nexport const x = 1;")).toBe(0);
  });

  it("ignores string literals (no AST node)", () => {
    expect(count('const s = "@glyphs-ai/catalog";')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Sanity — at least one T0/T1 pkg src file was scanned, so the audit
// hasn't silently no-op'd because of a path-resolution bug.
// ──────────────────────────────────────────────────────────────────────

describe("inter-service-imports audit sanity", () => {
  it("scanned at least one TS file in at least one T0/T1 pkg's src/", () => {
    let count = 0;
    for (const dom of DOMAIN_PKGS) {
      const srcDir = path.join(PACKAGES_DIR, dom, "src");
      if (!safeIsDir(srcDir)) continue;
      for (const _ of walkFiles(srcDir, { match: isTsFile })) {
        count++;
        if (count > 0) break;
      }
      if (count > 0) break;
    }
    expect(count).toBeGreaterThan(0);
  });
});
