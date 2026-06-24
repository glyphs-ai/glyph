# @glyphs-ai/e2e

Cross-package end-to-end / integration tests for glyph. **Private
package** — no published artifact, no production code, test-only.

## What lives here

Tests whose subject under test is the **interaction between two or
more packages** (or between glyph and the OS). Tests for a single
package's internals stay in that package's `test/` directory.

```
test/
  architecture/
    inter-service-imports.test.ts    # T0/T1 pkgs only type-import sibling T0/T1
    split-convention.test.ts         # facade + sibling-subdir split discipline
    test-layout-convention.test.ts   # test path mirrors src path
    tier-invisibility.test.ts        # app consumers only see allowlisted surfaces
  cli/
    bundle-smoke.test.ts             # single-file `bundle/glyph.js` (opt-in: BUNDLE_SMOKE=1)
    integration-smoke.test.ts        # CLI → real HTTP server round-trips
    spawn-smoke.test.ts              # CLI subprocess lifecycle + bundle smoke
  _helpers/
    cli-bundle.ts                    # shared spawn / port / CLI_BIN + bundle resolver
    ts-imports.ts                    # shared AST import/export extractor
    walk.ts                          # shared file/dir tree walkers
```

Tests are grouped by the **subject** of the test (`test/architecture/`
for repo-wide source-tree audits, `test/cli/` for CLI lifecycle) —
not by their origin package.

Architecture audits follow the canonical tier model: T0 foundations are
workspace, runtime, schedule, terminal, and catalog; T1 modes are
session, task, and workflow; T2 is contracts + api; T3 is server; and
T_top is dashboard + cli. Top-level apps consume workflow through
contracts and server routes, not by importing `@glyphs-ai/workflow`
directly.

## Why a separate package

This package keeps real server boots out of the fast package-local CLI
unit suite. With the e2e split:

- `@glyphs-ai/cli` keeps only fast unit tests (argv parsing, in-process
  API contract via mocked fetch).
- Heavy spawn/boot tests live here and only run when somebody is
  willing to wait for them.

## How to run

The `test/cli/` smoke tests spawn the bundled CLI at
`packages/cli/dist/bin.js`, so a build is required first:

```bash
pnpm --filter @glyphs-ai/cli build
pnpm --filter @glyphs-ai/e2e test
```

`pnpm -r build && pnpm -r test` (the repo-wide command) runs the
build first so this just works.

The `test/architecture/` audits read source files directly via
`node:fs` walk — they do NOT need a build to run.

### Single-file bundle smoke

`bundle-smoke.test.ts` execs the published single-file binary
`bundle/glyph.js`, which only `pnpm bundle` produces (it inlines the
migrations + dashboard). It is skipped unless `BUNDLE_SMOKE=1` is set:

```bash
pnpm bundle
BUNDLE_SMOKE=1 pnpm --filter @glyphs-ai/e2e test
```

With the flag set but no artifact present the suite fails (rather than
skips) so an explicit opt-in surfaces the missing `pnpm bundle` step.

## Expected runtime

On Windows, this package's vitest pass is ~10–12 s — the CLI smoke
files each pay one real server boot. On Linux/macOS it's typically
faster because the spawn + SQLite startup paths are cheaper there.
The `test/architecture/` audits add < 1 s each (pure file-tree
walks).
