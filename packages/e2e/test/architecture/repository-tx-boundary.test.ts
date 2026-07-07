/**
 * Structural enforcement of the request-scoped transaction boundary.
 *
 * Repositories are write-side infrastructure that MUST NOT own or start
 * transactions — they receive a `Tx` handle via constructor injection
 * and the request-scoped middleware owns the transaction lifecycle.
 *
 * Enforced invariants:
 *
 *   1. Repository files MUST NOT contain `.transaction(` calls.
 *   2. Repository files MUST NOT contain `SAVEPOINT` SQL literals.
 *   3. Repository files MUST NOT contain `RELEASE` SQL literals
 *      (companion to SAVEPOINT).
 *   4. Repository files MUST NOT contain `ROLLBACK TO` SQL literals.
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
