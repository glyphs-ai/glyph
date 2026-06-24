# `@glyphs-ai/contracts`

> **Tier:** T2 (Application). See the [tier model](../../docs/architecture.md#tier-model).

**Tier T2 (sibling of `@glyphs-ai/api`).** The strict-isolation entrypoint for
glyph's external surfaces: pure types (wire shapes, route catalog, domain
type re-exports) plus pure-function path helpers. No orchestration code.

## Audience

- **`@glyphs-ai/dashboard`** — sole workspace dep (declared under
  `devDependencies` because every import is `import type` and gets
  erased). Browser code needs wire
  shapes for HTTP responses and the route catalog for typed `fetch` calls;
  it must never pull Node-side orchestration into the SPA bundle. This pkg
  is structurally incapable of leaking such code into the dependency graph.
- **`@glyphs-ai/cli`** — wire shapes + route catalog. CLI keeps the
  additional `@glyphs-ai/server` dep for `runServer` (the in-process
  `glyph serve` subcommand) and for the CLI-lifecycle path helpers
  (`resolveGlyphHome`, `logsDir`, `runtimeFilePath`, `RuntimeFile`)
  that ship from server because they value-import `node:os` /
  `node:path` and have no place in the SPA-safe surface.
- **`@glyphs-ai/server`** — uses these via `@glyphs-ai/api`'s re-export. Direct
  dep is allowed but not required.
- **`@glyphs-ai/api`** — re-exports everything here from its root barrel so
  server has a single import site.

## Contents

| File | Purpose |
|------|---------|
| `domain.ts` | Type-only re-exports of T0/T1 package types that cross the wire (`Agent`, `AgentEntry`, `Skill`, `Schedule`, `Task`, etc.) |
| `health.ts` | `HealthResponse` for `GET /api/health` |
| `plan-to-manifest.ts` | Manifest tree shapes for catalog plan resolution |
| `routes.ts` | Facade for the route manifest: composes the per-domain slices in `routes/` into the `ROUTES` registry and re-exports `RouteSpec<Req, Res>` plus every request/response body type the HTTP API exposes |
| `routes/` | Per-domain route slices (`system`, `workspaces`, `sessions`, `tasks`, `schedules`, `workflows`, `catalog`) and the `_spec` primitives; package-private, reached only through the `routes.ts` facade (see `docs/pkg-template.md` § Splitting big files) |
| `runtimes.ts` | `RuntimeInfo` for `GET /api/runtimes` |
| `schedules.ts` | Wire-shape schedule target DTOs (`TaskTargetData`, `TaskScheduleTargetWire`, `ScheduleWireTarget`) |
| `server-config.ts` | `ServerConfig` for `GET /api/config` (response type referenced by `routes.ts`) |
| `workflows.ts` | Workflow DTOs and terminal payload shapes for the T1 `@glyphs-ai/workflow` substrate, mirrored without importing its runtime implementation |

## Dependencies

Every workspace package this contract surface references —
`@glyphs-ai/catalog`, `@glyphs-ai/runtime`, `@glyphs-ai/schedule`,
`@glyphs-ai/session`, `@glyphs-ai/task` — is consumed **`import type` only**:
the domain re-exports in `domain.ts` and the route body types erase completely
at compile time, so nothing from these packages survives into the emitted JS.
They are therefore declared as **optional `peerDependencies`**
(`peerDependenciesMeta.*.optional = true`) rather than runtime `dependencies`,
and mirrored under `devDependencies`:

- **`peerDependencies` (optional)** — documents the version contract for a
  consumer that already pulls these packages in, without forcing them into the
  module graph of one (e.g. dashboard) that needs only the erased types.
- **`devDependencies`** — supplies the `.d.ts` for local `tsc` and pins the
  build order (`pnpm -r` orders by dev + prod deps), since the optional peers
  are not auto-installed.

A `dependencies` entry would advertise a runtime coupling that does not exist;
the peer-optional + dev pattern keeps the manifest honest.

## Why a separate pkg

This package gives **structural isolation**: dashboard's `pnpm install`
literally cannot resolve `composeApplication`, `WorkspaceContext`,
`CatalogService`, or any other Node-only orchestration class — they are
not in its module graph.

This mirrors the consumer-port discipline applied between bounded
contexts: state-owning packages must be reached through a port, not
imported directly. Here the principle scales up: the composition root
(`@glyphs-ai/api`) is itself fenced off from external surfaces by the
narrower wire-only `@glyphs-ai/contracts` pkg.

## What lives here vs. `@glyphs-ai/api` vs. `@glyphs-ai/server`

- Type that crosses the HTTP boundary, or the catalog wire surface →
  **here**.
- Pure leaf function whose only effect is `path.join` / env-var read AND
  is needed by dashboard → **here**. (Today there are none — every
  current path helper is CLI / server only, see next bullet.)
- Function whose only consumers are CLI process-management commands and
  the server (`resolveGlyphHome`, `logsDir`, `runtimeFilePath`,
  `RuntimeFile`) → **`@glyphs-ai/server`**. Keeps `node:os` /
  `node:path` value-imports out of the dashboard-facing barrel; CLI
  reaches them through its existing `@glyphs-ai/server` workspace dep.
- Function that allocates a Drizzle handle, spawns a subprocess, mutates
  the workspace registry, or otherwise needs server-side execution
  context → **`@glyphs-ai/api`**.

When in doubt: if it would be safe to call from a browser-side bundle
(setting aside `node:path` polyfilling concerns) AND dashboard or CLI
actually uses it, it belongs here.
