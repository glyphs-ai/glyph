# Contributing to glyph

Thanks for helping shape glyph. This guide covers the local setup, the
day-to-day loop, where to add new things, and what a reviewer expects on
a pull request. For the design rationale behind the package layout, read
[`architecture.md`](./architecture.md) first; for the philosophy, read
[`paradigm.md`](./paradigm.md).

## Prerequisites

- **Node >= 22** (declared in the root `package.json` `engines.node`).
- **pnpm 10.x** (pinned via `packageManager` in `package.json`). The
  easiest way to get the pinned version is `corepack enable && corepack
  prepare`. Do not switch package managers - there is one lockfile
  (`pnpm-lock.yaml`) and no `npm`/`yarn`/`bun` sibling.

## First build

```sh
git clone https://github.com/glyphs-ai/glyph.git
cd glyph
pnpm install
pnpm build        # tsc emit - run this once after a fresh clone
```

`pnpm build` is mandatory before `pnpm typecheck` or `pnpm dev` on a
fresh tree: each package's `tsconfig` resolves its siblings through their
emitted `dist/*.d.ts`, so a cold typecheck or dev boot will surface
"missing export" errors that are really just a missing build. See
[`architecture.md` -> Testing posture](./architecture.md#testing-posture).

## Daily loop

```sh
pnpm dev                                  # hot-reloading API (:41817) + Vite dashboard (:8787)
pnpm --filter @glyphs-ai/<pkg> test --watch   # focus one package's vitest suite
pnpm typecheck                            # tsc --noEmit across every package
```

`pnpm dev` runs the dashboard dev server on `8787` and proxies `/api/*`
to the backend on `41817`; that pairing is pinned by
`packages/server/test/dev-port-pin.test.ts`. See
[`../packages/dashboard/README.md`](../packages/dashboard/README.md) for
the full per-mode port table.

## Commands

All commands run from the repo root.

| Command                                  | What it does                                              |
| ---------------------------------------- | --------------------------------------------------------- |
| `pnpm build`                             | `tsc` emit across every package (run first on a fresh tree). |
| `pnpm typecheck`                         | `tsc --noEmit` per package.                               |
| `pnpm test`                              | vitest across every package.                              |
| `pnpm --filter @glyphs-ai/<pkg> test`    | tests for a single package.                               |
| `pnpm lint`                              | `biome check .`                                           |
| `pnpm format`                            | `biome format --write .`                                  |
| `pnpm bundle`                            | build the single-file CLI binary (`bundle/glyph.js`); needed only for release / e2e. |
| `pnpm knip`                              | dead-code / unused-dependency scan.                       |
| `pnpm new-pkg <name> <EntityName> <table_name>` | scaffold a new `packages/<name>/` from `_template`. |

Run the full gate before opening a PR:

```sh
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

## Adding things (pointer map)

| You want to add ...        | Start here                                                                 |
| -------------------------- | ------------------------------------------------------------------------- |
| A new package              | `pnpm new-pkg <name> <EntityName> <table_name>`, then [`pkg-template.md`](./pkg-template.md). |
| A new HTTP route           | [`architecture.md` -> Adding a new HTTP route](./architecture.md#adding-a-new-http-route). |
| A new CLI command          | [`architecture.md` -> Adding a new CLI command](./architecture.md#adding-a-new-cli-command). |
| A new runtime adapter      | [`architecture.md` -> Adding a new runtime](./architecture.md#adding-a-new-runtime). |
| A first-party agent / skill / MCP | [`../first-party/README.md`](../first-party/README.md).            |

## Pull requests

- **Branch** off `main` with a descriptive `<type>/<slug>` name.
- **Commit** with a Conventional Commit prefix: `feat:`, `fix:`,
  `refactor:`, `docs:`, `chore:`, `test:`. Keep one logical change per
  commit; commit messages are ASCII-only.
- **Describe** the PR as What / Why / Changes / How to test, and link the
  issue it closes.
- **Preserve the wire shape.** A refactor that moves code must not change
  observable HTTP behaviour unless that is the explicit point of the PR.

Releases are maintainer-only; see [`RELEASING.md`](./RELEASING.md).
