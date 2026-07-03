/**
 * Shared TypeScript import/export extraction for the repo-wide
 * architecture audits. Replaces the four near-identical AST/regex
 * scaffolders that previously lived in `inter-service-imports` and
 * `tier-invisibility`.
 *
 * One extractor, `extractImportRefs`, returns a classified record for
 * every module reference in a source file:
 *   - static `import ... from "x"` / side-effect `import "x"`,
 *   - `export ... from "x"` re-exports,
 *   - dynamic `import("x")` calls (classified as value imports).
 *
 * Each consumer filters the records it cares about:
 *   - inter-service value-import audit: `kind !== "export-from"` then
 *     `isValueImport`.
 *   - test-layout value-import mirror: `kind !== "export-from"` then
 *     `isValueImport`, mapped to specifier.
 *   - tier-invisibility fence: every record's specifier (value OR type,
 *     including re-exports and dynamic imports).
 *
 * Why AST over regex: a regex scan both false-positives on specifiers
 * mentioned inside comments / string literals and false-negatives on
 *     subpath specifiers (`@glyphs-ai/api/wire`). The AST walk has
 * neither failure mode.
 */

import ts from "typescript";

export type ImportRefKind = "static-import" | "dynamic-import" | "export-from";

/** A single module reference extracted from a source file. */
export interface ImportRef {
  /** Module specifier text, e.g. `"@glyphs-ai/catalog"` or `"./foo.js"`. */
  readonly specifier: string;
  /** `true` iff the reference contributes runtime code (not type-erased). */
  readonly isValueImport: boolean;
  /** Which syntactic form produced the reference. */
  readonly kind: ImportRefKind;
}

/**
 * Recognise vitest mocking call expressions (`vi.mock("...")`,
 * `vi.importActual("...")`, `vi.doMock("...")`, `vi.unmock("...")`).
 * The specifier in these is a harness directive naming a module to
 * virtualise, not a subject under test.
 */
function isViMockingCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (!ts.isIdentifier(expr.expression)) return false;
  if (expr.expression.text !== "vi") return false;
  const name = expr.name.text;
  return name === "mock" || name === "importActual" || name === "doMock" || name === "unmock";
}

/**
 * Classify an `import` clause as value-contributing or type-only.
 *
 * Value (`true`):
 *   - side-effect-only `import "x"` (no clause; executes top-level code),
 *   - default binding `import x from "..."`,
 *   - namespace binding `import * as ns from "..."`,
 *   - named `import { a } from "..."` with at least one non-`type` specifier.
 *
 * Type-only (`false`):
 *   - whole-clause `import type { ... }` / `import type * as Ns`,
 *   - mixed `import { type a, type b }` where every specifier is `type`.
 *
 * The two AST levels matter: `clause.isTypeOnly` is true only for the
 * whole-clause form; the mixed form keeps that flag false and flips
 * each `ImportSpecifier.isTypeOnly` individually.
 */
function clauseIsValueImport(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    // Defensive: no name, no bindings, not type-only — malformed; surface
    // it as a value so nothing unexpected is silently swallowed.
    return true;
  }
  if (ts.isNamespaceImport(bindings)) return true;
  if (ts.isNamedImports(bindings)) {
    return bindings.elements.some((el) => !el.isTypeOnly);
  }
  return true;
}

/**
 * Extract every module reference from `source`. `fileName` only drives
 * TS-vs-TSX parsing (its `.tsx` suffix selects the JSX-aware scanner);
 * the file need not exist on disk, so this is equally usable against
 * real files and hand-crafted self-test strings.
 *
 * References are emitted in source order. Vitest harness calls are not
 * descended into (their factory body's `vi.importActual` / nested
 * `await import` wiring is harness, not subject). `ImportTypeNode`s
 * (`type Y = import("X").Foo`) are ignored — already type-erased.
 */
export function extractImportRefs(source: string, fileName: string): ImportRef[] {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const out: ImportRef[] = [];

  const visit = (node: ts.Node): void => {
    // Static `import ... from "x"` and side-effect `import "x"`.
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        out.push({
          specifier: node.moduleSpecifier.text,
          isValueImport: clauseIsValueImport(node.importClause),
          kind: "static-import",
        });
      }
      // An import declaration never nests another module reference.
      return;
    }

    // `export ... from "x"` re-export. `node.isTypeOnly` is true for
    // `export type { ... } from "..."`.
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        out.push({
          specifier: node.moduleSpecifier.text,
          isValueImport: !node.isTypeOnly,
          kind: "export-from",
        });
      }
      return;
    }

    // Dynamic `import("x")` — executes runtime code, so always a value.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) {
        out.push({ specifier: arg.text, isValueImport: true, kind: "dynamic-import" });
      }
      // Fall through to recurse; the call's other args have nothing to skip.
    }

    // Harness directive — skip the whole call (do not descend).
    if (ts.isCallExpression(node) && isViMockingCall(node)) {
      return;
    }

    // `type Y = import("X").Foo` — type-erased; ignore.
    if (ts.isImportTypeNode(node)) {
      return;
    }

    node.forEachChild(visit);
  };

  visit(sf);
  return out;
}
