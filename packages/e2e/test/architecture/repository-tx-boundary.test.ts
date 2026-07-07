/**
 * Structural enforcement of the request-scoped transaction boundary.
 *
 * Repositories are write-side infrastructure that MUST NOT own or start
 * transactions — they receive a `Db` handle via constructor injection
 * and the request-scoped middleware owns the transaction lifecycle.
 *
 * Queries are read-side infrastructure that MUST NOT accept a `tx`
 * handle — they read from the stable `db` connection to get
 * committed-snapshot semantics without coupling to the write path.
 *
 * Enforced invariants:
 *
 *   1. Repository files MUST NOT contain `.transaction(` calls.
 *   2. Repository files MUST NOT contain `SAVEPOINT` SQL literals.
 *   3. Repository files MUST NOT contain `RELEASE` SQL literals
 *      (companion to SAVEPOINT).
 *   4. Repository files MUST NOT contain `ROLLBACK TO` SQL literals.
 *   5. Queries files MUST NOT accept `tx` in constructor signatures.
 *
 * These patterns were removed as part of the request-scoped UoW
 * migration (PR #149). This test prevents regressions.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../_helpers/walk.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/** Domain packages whose repos participate in the shared-client UoW. */
const DOMAIN_PKGS = ["catalog", "session", "task", "schedule", "workflow"] as const;

/** Forbidden patterns in repository source files. */
const FORBIDDEN_PATTERNS = [
  { pattern: /\.transaction\s*\(/, label: ".transaction(" },
  { pattern: /SAVEPOINT/i, label: "SAVEPOINT" },
  { pattern: /RELEASE\s+/i, label: "RELEASE" },
  { pattern: /ROLLBACK\s+TO/i, label: "ROLLBACK TO" },
] as const;

function collectRepoFiles(): Array<{ pkg: string; rel: string; abs: string }> {
  const results: Array<{ pkg: string; rel: string; abs: string }> = [];
  for (const pkg of DOMAIN_PKGS) {
    const srcDir = path.join(PACKAGES_DIR, pkg, "src");
    for (const abs of walkFiles(srcDir, { match: (n) => n.endsWith("-repository.ts") })) {
      results.push({ pkg, rel: path.relative(PACKAGES_DIR, abs), abs });
    }
  }
  return results;
}

function collectQueriesFiles(): Array<{ pkg: string; rel: string; abs: string }> {
  const results: Array<{ pkg: string; rel: string; abs: string }> = [];
  // Queries live under infrastructure/drizzle/ — override skipDirs to
  // allow traversal into the drizzle directory (which DEFAULT_SKIP_DIRS
  // excludes to avoid generated migration SQL).
  const skipDirs = new Set(["node_modules", "dist"]);
  for (const pkg of DOMAIN_PKGS) {
    const srcDir = path.join(PACKAGES_DIR, pkg, "src");
    for (const abs of walkFiles(srcDir, { skipDirs, match: (n) => n.endsWith("-queries.ts") })) {
      results.push({ pkg, rel: path.relative(PACKAGES_DIR, abs), abs });
    }
  }
  return results;
}

describe("repository transaction boundary", () => {
  const repoFiles = collectRepoFiles();

  it("finds at least one repository file per domain package", () => {
    for (const pkg of DOMAIN_PKGS) {
      const found = repoFiles.filter((f) => f.pkg === pkg);
      expect(found.length, `expected at least one *-repository.ts in ${pkg}`).toBeGreaterThan(0);
    }
  });

  for (const { rel, abs } of collectRepoFiles()) {
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      it(`${rel} does not contain ${label}`, () => {
        const src = readFileSync(abs, "utf8");
        const match = pattern.exec(src);
        expect(
          match,
          `${rel} contains forbidden pattern "${label}" at offset ${match?.index}. ` +
            `Repositories must not own transactions — the request-scoped middleware handles the lifecycle.`,
        ).toBeNull();
      });
    }
  }
});

describe("queries read-side boundary", () => {
  const queriesFiles = collectQueriesFiles();

  it("finds at least one queries file per domain package", () => {
    for (const pkg of DOMAIN_PKGS) {
      const found = queriesFiles.filter((f) => f.pkg === pkg);
      expect(found.length, `expected at least one *-queries.ts in ${pkg}`).toBeGreaterThan(0);
    }
  });

  for (const { rel, abs } of collectQueriesFiles()) {
    it(`${rel} constructor does not accept a tx parameter`, () => {
      const src = readFileSync(abs, "utf8");
      // Match constructor signatures that reference tx — queries
      // must only receive `db` (stable handle), never a transaction.
      const txParamPattern = /constructor\s*\([^)]*\btx\b[^)]*\)/;
      const match = txParamPattern.exec(src);
      expect(
        match,
        `${rel} constructor accepts a "tx" parameter at offset ${match?.index}. ` +
          `Queries classes must only accept "db" (the stable read handle), not a transaction.`,
      ).toBeNull();
    });
  }
});
