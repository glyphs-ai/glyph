# Service package template

This document describes the standard layout every BC-owning service
package in glyph follows.

> **Canonical source of truth:** the **Layout** + layering rules below, the
> `packages/_template/` scaffold, and `packages/workspace/` (the smallest
> package that follows them).

## Known exceptions

Not every package in the repo is a BC-owning service. The following
packages intentionally diverge from this template; none of them carry
their own table definitions / service / repository / drizzle module:

| Package                  | Role                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `@glyphs-ai/runtime`     | Runtime adapter registry (`copilot`, ...).                                 |
| `@glyphs-ai/terminal`    | Thin PTY / shell wrapper: spawn / quoting / platform primitives.           |
| `@glyphs-ai/api`         | Composition root that wires T0 / T1 modules into per-workspace contexts; also owns the wire contracts under its `wire/` surface. |
| `@glyphs-ai/server`      | Transport adapter: Hono routes + middleware over the api composition.     |
| `@glyphs-ai/cli`         | Surface: command registrars over the typed HTTP client.                    |
| `@glyphs-ai/sdk`         | Generated, browser-safe HTTP client + re-derived wire types. No `src` hand-written beyond thin helpers. |
| `@glyphs-ai/dashboard`   | Surface: browser SPA (Vite + React); tests use MSW.                       |
| `@glyphs-ai/e2e`         | Tests-only: no `src/`, no published API.                                   |

Each package's README states its tier; consult that and this table
rather than asking each README to restate its divergence.

## Scaffold a new service package

```bash
pnpm new-pkg <pkg-name> <EntityName> <table_name>
# e.g.
pnpm new-pkg notebook Note notes
pnpm install
pnpm --filter @glyphs-ai/notebook db:generate
pnpm --filter @glyphs-ai/notebook test
```

The scaffolder copies `packages/_template/`, substitutes the placeholder
tokens (`__PKG__` / `__Entity__` / `__entity__` / `__entities__` /
`__entity-kebab__`), and deletes the placeholder migration so
drizzle-kit can regenerate it from
`src/infrastructure/drizzle/<entity>-schema.ts`. The result is a
**domain / application / infrastructure** package with a single main
entry (`.`); there is no separate declaration entry.

## Layout

```
packages/<pkg>/
  src/
    index.ts                    package-root barrel: NAMED exports of the whole public
                                surface (per-use-case Request/Response/Error contracts, the
                                <entity>-public symbols, compose<Entity>Module + its option/
                                result types, the db factory). NO `export *`.
    <entity>-module.ts          compose<Entity>Module({ db }) — the composition root: takes/
                                opens the Db, builds the repository + queries, wires use-cases.

    domain/                     the RICH domain model (充血) — owns invariants + validation
      <entity>-entity.ts        the aggregate: state transitions live here and return
                                domain-error DUs via `Result` (never throw). `new` rehydrates
                                trusted persisted state; `create` mints a fresh aggregate.
      <entity>-id.ts            branded id value object + its zod schema (validates the id)
      <entity>-<value>.ts       other value objects, each with its own schema (per-property
                                validation)
      <entity>-repository.ts    WRITE-side repository PORT — `get` / `save` / `delete` only,
                                plus the error atoms (DatabaseUnavailable, <Entity>NotFound)

    application/                use-cases — flexible standalone external contracts
      <use-case>.ts             one file per use-case: its OWN Request/Response zod schema +
                                Error union + the UseCase class
      use-case.ts               UseCase<I,O,E> interface + DomainResult / UseCaseResult aliases
      <entity>-public.ts        NAMED re-exports of the domain symbols that cross the pkg
                                boundary (branded id + schema, error atoms) + the closed
                                <Entity>Error union. NO `export *`.
      ports/                    (optional) application-layer ports the module injects

    infrastructure/             adapters — the only layer allowed to touch third-party IO
      drizzle/
        <entity>-db.ts          openDb / Db type (better-sqlite3 + drizzle)
        <entity>-schema.ts      drizzle table definitions + private Row types
        <entity>-mapper.ts      the repository's bound MAPPER: domain entity <-> db row
        <entity>-repository.ts  the WRITE-side repository IMPL (get/save/delete via the mapper)
        <entity>-queries.ts     the READ-side seam: interface + Drizzle impl, CO-LOCATED here
                                (not in domain). Exposes the table + `query<T>(fn):
                                ResultAsync<T, DatabaseUnavailable>`; read use-cases compose
                                their own SELECTs and project raw ROWS.
        <entity>-migrations.ts  generated migration bundle
      file/                     (optional) filesystem / other adapters

  drizzle/                      generated SQL migrations (committed)
  drizzle.config.ts             points at ./src/infrastructure/drizzle/<entity>-schema.ts
  package.json / tsconfig*.json / vitest.config.ts
```

### Layering rules (what each layer owns)

- **domain** — the RICH model (充血). Owns every invariant and validates the
  whole aggregate's legitimacy down to each property (value objects carry their
  own zod schema). State transitions are methods on the entity that return
  domain-error discriminated unions via `Result` — the domain never throws. The
  write-side repository PORT lives here and exposes only `get` / `save` /
  `delete`; there is no `find*` / `list` / `insert` on it (those are read
  concerns, or fold into `save`).
- **application** — one use-case per file. A use-case is a flexible, standalone
  external contract: it defines its OWN `Request` / `Response` zod schema and
  Error union, even when the shape currently matches the domain or another
  use-case. Today's identical shapes are not guaranteed to stay identical, so we
  accept a little redundancy to keep each use-case free to diverge. Write
  use-cases depend on the repository; read use-cases depend on the queries seam.
  `<entity>-public.ts` is the one curated file that named-re-exports the domain
  symbols crossing the boundary.
- **infrastructure** — the only layer that touches third-party IO (SQLite,
  filesystem, HTTP). The repository IMPL and its bound MAPPER (entity <-> row)
  live here, and so does the `queries` seam (interface + impl co-located).
  Queries return raw ROWS, not domain entities, so read use-cases stay decoupled
  from the aggregate and can shape their SELECTs freely.

### Barrels: no `export *`

Both `index.ts` (package root) and `application/<entity>-public.ts` enumerate
their exports by name. `export *` is avoided so the public surface stays
explicit + greppable and no stray internal symbol leaks across the boundary.

## Typecheck configuration

Every pkg ships a dedicated `tsconfig.typecheck.json` that broadens
`include` to cover both `src/**/*` and `test/**/*`. The `typecheck`
script invokes `tsc -p tsconfig.typecheck.json`; the file extends
`./tsconfig.json` (the build config) and overrides only what's
needed for a typecheck-only pass:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

The separate `tsconfig.typecheck.json` typechecks `test/` as well as
`src/`: `vitest run` transpiles tests with esbuild and never reports
their type errors (e.g. passing `undefined` to a field that forbids it
under `exactOptionalPropertyTypes`).

`noEmit: true` lives in the config, not just the CLI flag, so
`tsc -p tsconfig.typecheck.json` never writes `.d.ts` or `.js` into
`dist/`.

**Pkgs that diverge**: `packages/dashboard` keeps the same script
shape but its `tsconfig.typecheck.json` uses `"include": ["src",
"test"]` (no `rootDir`, no `exclude`) — Vite's module-resolution
settings make the backend-style options unsafe to copy verbatim.
`packages/e2e` uses `"include": ["test/**/*"]` (no `src/**/*`)
because it has no `src/`.

## Test layout convention

As a guideline, a test file lives under the `test/` mirror of the `src/`
subdirectory it covers — a use-case test for `src/application/<group>/x.ts`
at `test/application/<group>/`, a pure domain unit test at `test/domain/`.
Cross-cutting, umbrella, and fixture-driven suites that don't map to a
single `src/` subtree stay flat at `test/<name>.test.{ts,tsx}`.

This is a review-time guideline, not a machine-enforced rule: group tests
by the subject they cover and use judgement.

## Test file naming

Test files mirror the source file they test, with `.test.ts` appended.
Large suites split by feature with a `.<feature>` infix.

| source | test |
| ------ | ---- |
| `application/<verb>-<entity>.ts` | `test/application/<verb>-<entity>.test.ts` |
| `application/<verb>-<entity>.ts` (per-feature suite) | `test/application/<verb>-<entity>.<feature>.test.ts` |
| `infrastructure/drizzle/<entity>-repository.ts` | `test/infrastructure/drizzle/<entity>-repository.test.ts` |
| `infrastructure/drizzle/<entity>-queries.ts` | `test/infrastructure/drizzle/<entity>-queries.test.ts` |
| `domain/<entity>-entity.ts` | `test/domain/<entity>-entity.test.ts` |
| `domain/<entity>-id.ts` | `test/domain/<entity>-id.test.ts` |
| `<entity>-module.ts` | `test/<entity>-module.test.ts` |

A single source module may have several test files, split by feature or
scenario:
- `<verb>-<entity>.<feature>.test.ts` — per-feature splits of a use-case
  or engine.
- `<entity>-repository.<scenario>.test.ts` — per-scenario splits of a
  repository.

Tests under a sub-folder mirror the source sub-folder:
`src/application/<verb>-<entity>.ts` → `test/application/<verb>-<entity>.test.ts`.

NEVER name a test file by an old class name or a non-source concept
word.

## Public API guard

A package locks its public surface with a `test/public-api-guard.test.ts`
that uses Vitest's `expectTypeOf` at typecheck time. The test:

- Asserts every public use-case class exists by name, with its
  `Request` / `Response` / `Error` types.
- Asserts every exported value object and schema (e.g. `<Entity>IdSchema`).
- Asserts `compose<Entity>Module` and the `<Entity>Module` /
  `<Entity>ModuleOptions` types are exported.
- Asserts the root `index.ts` exports the whole public surface by name —
  never persistence, mapper, or entity internals.

`expectTypeOf` catches silent renames or signature changes at
`pnpm typecheck` time, before downstream pkgs surface the breakage. As a
type-only assertion it costs nothing at runtime.

When a public method, error class, schema, or DTO is added / renamed / removed,
the guard test fails until updated in the SAME PR — review enforces
the coupling.

## File naming convention

**Domain / role files use a kebab-case `<entity>-<role>.ts` name** (a
hyphen separates the aggregate facet from the role facet); use-cases are
`<verb>-<entity>.ts`:

| file pattern | exports |
|---|---|
| `domain/<entity>-entity.ts` | `<Entity>Entity` |
| `domain/<entity>-id.ts`, `domain/<entity>-<value>.ts` | branded value objects (`<Entity>IdSchema`, `<Entity>NameSchema`, …) |
| `domain/<entity>-repository.ts` | `<Entity>Repository` write port + error atoms |
| `application/<verb>-<entity>.ts` | `<Verb><Entity>UseCase` + its `Request` / `Response` / `Error` |
| `application/<entity>-public.ts` | named domain re-exports + `<Entity>Error` union |
| `infrastructure/drizzle/<entity>-schema.ts` | drizzle table + `<Entity>Row` |
| `infrastructure/drizzle/<entity>-mapper.ts` | `<Entity>Mapper` |
| `infrastructure/drizzle/<entity>-repository.ts` | `Drizzle<Entity>Repository` |
| `infrastructure/drizzle/<entity>-queries.ts` | `<Entity>Queries` + `Drizzle<Entity>Queries` |
| `infrastructure/drizzle/<entity>-db.ts` | `openDb`, `Db` |
| `<entity>-module.ts` | `compose<Entity>Module`, `<Entity>Module`, `<Entity>ModuleOptions` |

A multiword entity is kebab-cased throughout (`TaskGroup` →
`task-group-entity.ts`, `task-group-repository.ts`). Test files mirror the
same pattern with `.test.ts` appended.

The layer directory also namespaces files, but the per-file aggregate
prefix is still required. A repo-wide Ctrl-P for `workspace-repository` or
`register-workspace` must be unique across the sibling domain packages.

**Tooling-locked / structural bare names** are exempt from the
`<entity>-` prefix rule:

- `index.ts` — barrels.
- `use-case.ts` — the shared `UseCase<I, O, E>` interface + result aliases.
- package config files such as `drizzle.config.ts`, `tsconfig.json`, and
  `vitest.config.ts`.

Other package-private helpers are named for their concern (`paths.ts`,
`framing.ts`, `format.ts`, `_helpers.ts`, `_shared.ts`) and live in the
layer that owns the concern.

File names are the grep / IDE token for class location, so every package
— single- or multi-entity — prefixes class-bearing files uniformly.

## Package-private utility files

Files and subdirs whose names start with `_` are package-private
utilities — pure functions, type aliases, or test factories that
the pkg uses internally but does NOT export. The convention is
enforced by `packages/e2e/test/architecture/split-convention.test.ts`,
which skips `_*` files when checking SPLIT compliance (they are
allowed to be siblings of the facade without being delegates).

Canonical names:

- `_helpers.ts` — pure helper functions specific to a single facade
  or module.
- `_shared.ts` — pure helpers shared across multiple files within
  the same pkg or subdir. Used by `terminal/src/_shared.ts`.
- `_<topic>.ts` — a package-private module grouping one cohesive
  slice of internal logic that is too big to inline in the service
  but is not part of the public surface. Named for the concern, not a
  generic "helpers" bucket. These let a large facade delegate to focused
  modules while keeping them out of the barrel.
- `_<topic>/` — package-private subdir grouping related helpers
  (e.g. `catalog/src/_shared/` groups DI plumbing helpers).

Files starting with `_` are not re-exported from `index.ts` **as
modules** — the barrel never does `export * from "./_x.js"`, and a `_`
file never becomes a second public entry point. A `_<topic>.ts` MAY,
however, own a small number of genuinely-public *value consts* (e.g.
an operational cap such as a retry limit) that the barrel re-exports
by name; the module's functions and types stay internal. Prefer
per-use-case `Request`/`Response` schemas (`application/<use-case>.ts`) or
domain value objects (`domain/<entity>-{id,name}.ts`) for broadly-public
types — reach for a named const re-export from a `_` module only when the
const is inseparable from the internal concern that owns it.

Tests for `_` files live alongside the helper they cover
(`test/application/_helpers.test.ts` is a valid layout per § "Test
layout convention" rule 2).

## Where DTOs live

> See [docs/architecture.md § The three layers](./architecture.md#the-three-layers) for the Row / Entity / DTO split that motivates the surface rule.

Each use-case owns its own **public contracts**: a `RequestSchema` and
`ResponseSchema` (zod; the TS type is `z.infer<typeof ...>`) plus an `Error`
union — all declared at the top of `application/<use-case>.ts`. Use-cases
**do not share DTOs**: identical-looking shapes today may diverge as each
use-case evolves its own external contract independently. Accept the
redundancy.

Shared value objects (id, name, other per-property validators) live in
`domain/<entity>-{id,name}.ts`. Cross-boundary domain types are
named-re-exported via `application/<entity>-public.ts`; the pkg root
`index.ts` named-exports the whole public surface. There is no `contract/`
directory and no single `<entity>.types.ts` file.

The only exceptions to "use-cases own their types" are:

- `infrastructure/drizzle/<entity>-schema.ts` MAY define `<Entity>Row`
  (via `$inferSelect`) for the mapper's row ↔ entity conversion, but that
  type is **infrastructure-private** — never re-exported from `index.ts`
  and never used in a repository's public signature (which speaks
  `<Entity>Entity`).
- `<entity>-module.ts` exports `<Entity>Module` and `<Entity>ModuleOptions`
  alongside `compose<Entity>Module`. These are composition-surface types
  (how downstream packages wire the pkg), distinct from per-use-case DTOs.
- Capability-interface seams are declared by the consumer package when a
  downstream needs a narrow surface (for example `AgentContentSource` or
  `SpawnFn`). The port surface is a cross-pkg seam, distinct from per-use-case
  DTOs.

## Type placement (which package owns this type?)

> See [docs/architecture.md § The three layers](./architecture.md#the-three-layers) for the Row / Entity / DTO split inside one package. This section covers the orthogonal question: *which package* should host a given type.

The "Where DTOs live" section above governs *intra-package* type layout
(per-use-case `Request`/`Response` schemas in `application/<use-case>.ts`, shared
value objects in `domain/<entity>-{id,name}.ts`). This section governs
*inter-package* type layout — given a new type, which of glyph's type-owning
location kinds should host it.

| Kind of type | Lives in | One-line test |
|---|---|---|
| A single BC's entity / DTO / error / option shape | the owning domain pkg's `domain/<entity>-entity.ts`, per-use-case `application/<use-case>.ts` (Request/Response/Error union), or domain value objects (`domain/<entity>-{id,name}.ts`) | "Does it belong to one BC only? Would you delete it if you deleted that BC?" |
| HTTP wire contract OR cross-package path / route constant the surfaces need at compile time | `@glyphs-ai/api`'s `wire/` surface (fenced consumers see it via `@glyphs-ai/sdk`) | "Will it appear in a Network tab payload, OR is it a pure type / side-effect-free constant the dashboard / cli reaches for?" |
| In-process composition / runtime container holding live service instances or callbacks | `@glyphs-ai/api` | "Does it own `Promise<Service>` / a `(c) => Service` resolver, OR a cross-BC composition shape constructed once per workspace?" |
| HTTP-transport-internal type (`Hono.Context`-flavoured, route-resolver, middleware) | `@glyphs-ai/server` | "Does its signature reference `Hono.Context`, request bodies, or Express-style middleware?" |

### Decision rules (sharp edges)

1. **Types crossing the public boundary → `@glyphs-ai/api`'s `wire/` surface. Cross-BC composition / live-instance shapes → the rest of `@glyphs-ai/api`.**
   `@glyphs-ai/api` holds both halves: the `wire/` surface (pure types,
   side-effect-free route / path constants, zero orchestration) and the
   composition root that wires T0/T1 into per-workspace contexts. The
   api barrel re-exports `wire/` so the in-process server imports both
   via a single specifier; the fenced consumers
   (`@glyphs-ai/dashboard`, `@glyphs-ai/cli`) never import `api` — they
   get the same wire types from `@glyphs-ai/sdk`, whose self-contained
   `wire.ts` re-derives them from the generated client. Domain pkgs can
   `import type` from the api `wire/` surface when projecting their
   internal DTOs to wire shape — the inverse (a `wire/` file importing
   values from a domain pkg) is also fine because the wire surface is
   type-only and the value graph stays clean.

2. **Single domain's entity / DTO / error → that domain's pkg, never the api `wire/` surface.**
   If `Task` only makes sense as part of the task BC, it lives in
   `@glyphs-ai/task` domain/use-case modules, for example
   `packages/task/src/domain/task-entity.ts` or
   `packages/task/src/application/list-tasks.ts`. The api `wire/`
   surface re-exports the subset of domain types that actually appear on
   the HTTP wire (api depends on the domain pkgs for the type-only
   re-export). The server imports through `@glyphs-ai/api` and the
   surfaces import through `@glyphs-ai/sdk`, while the domain pkg owns
   the definition.
   `@glyphs-ai/api`'s composition layer owns *cross-BC composition* types
   only — never single-domain DTOs.

3. **Transport-specific glue → `server` (or the future transport pkg), never `api`.**
   A type whose signature mentions `Hono.Context`, `Request`, `Response`,
   or a route function is HTTP-specific and belongs in `server`. Promote
   to `api` only when a second transport (CLI direct-mode, MCP, gRPC)
   actually arrives and needs the same abstraction generically.

4. **Inter-domain-pkg dependencies must be mediated by ports.**
   `task` owns an `AgentResolver` port and does not import `catalog`;
   `api` adapts catalog to that port. Domain packages must NOT
   value-import from each other — that would couple two BCs at runtime
   and violate the "api is the only composer" invariant. Enforced
   mechanically by
   `packages/e2e/test/architecture/inter-service-imports.test.ts`.

5. **Surface (`dashboard`, `cli`) imports go through `@glyphs-ai/sdk`.**
   The fenced consumers MUST NOT import from `@glyphs-ai/api`, any T0
   pkg, or any T1 pkg. Their entire glyph-workspace surface is
   `@glyphs-ai/sdk` (plus, for `cli`, `@glyphs-ai/server` for the
   in-process server boot — the cli binary IS the server bundle).
   Enforced mechanically by
   `packages/e2e/test/architecture/tier-invisibility.test.ts`.

### Corollaries

- **Wire types vs domain types: when they diverge.** A domain pkg's
  internal `XxxEntity` and the wire `Xxx` DTO drift over time
  (`createdAt: Date` → `createdAt: string`, soft-delete fields hidden).
  When that happens, the wire shape moves to the api `wire/` surface;
  the entity stays in the domain. The service in the domain pkg owns
  the projection.

- **Errors that cross the wire.** Errors are discriminated-union atoms
  (`{ readonly type: "AgentNotFound"; ... }`). If a `type` literal
  appears in an HTTP error response the client branches on, it is
  wire-shape and should be re-declared in the api `wire/` surface. The
  atom type stays in the domain pkg's repository or entity module. Cross-pkg
  consumers branch on `err.type === "AgentNotFound"` — never `instanceof`
  (no class hierarchy) and never `err.name` (that is the old class-error
  convention). Rule 4 still forbids runtime cross-BC value imports.

- **Resolvers (`(c: Hono.Context) => Service`) stay in `server`.**
  Their parameter type is HTTP-specific; promoting to `api` would
  require introducing a generic `ServiceResolver<RequestCtx, Service>`,
  which has no second consumer today.

- **Avoid pure-rename facades.** A file in pkg X that does nothing but
  `export type Foo = OriginalFoo` from pkg Y is a refactoring smell:
  it suggests either (a) X needs to own Foo for real (move the
  definition), or (b) consumers should import directly from Y (delete
  the facade).

### Pitfalls observed in real PRs

- Putting a wire shape in the originating domain pkg "because it's
  defined there" — couples the wire to the domain. **Fix:** move it
  to the api `wire/` surface; have the domain pkg `import type` it for
  projection.

- Putting an in-process resolver type in `@glyphs-ai/api` "because it's
  used by routes" — pollutes the api pkg with `Hono.Context`.
  **Fix:** keep in `server`.

- Adding a type to `@glyphs-ai/api` (its composition layer or `wire/`
  surface) "because multiple downstreams use it" when it's actually a
  single-domain concept — bloats T2. **Fix:** put it in the owning
  domain pkg; re-export from the api `wire/` surface only if it
  genuinely appears in a Network-tab payload.

- A domain pkg value-importing another domain pkg's service or error
  type — silently builds a runtime cross-BC dep. **Fix:** use
  `import type`; thread the live instance through `@glyphs-ai/api`'s
  composer; for cross-BC error discrimination, branch on `err.type`
  (discriminated-union atoms). Mechanically audited by
  `inter-service-imports.test.ts`.

## Naming conventions

> See [docs/architecture.md § Coding conventions](./architecture.md#coding-conventions) for the full rationale.

### Public types and values

| concept | name / surface |
| ------- | -------------- |
| package name | `@glyphs-ai/<pkg>` |
| main entry | `@glyphs-ai/<pkg>`: the whole public surface (use-cases + value objects + compose); no `./contract` subpath |
| use-case class | `<Verb><Entity>UseCase` |
| operation request | `<Verb><Entity>Request` (+ `<Verb><Entity>RequestSchema`) |
| operation response | `<Verb><Entity>Response` (+ `<Verb><Entity>ResponseSchema`) |
| use-case error union | `<Verb><Entity>Error` |
| use-case dependencies | `<Verb><Entity>Deps` (constructor opts; see "Parameter & constructor shape") |
| value object | `<Entity>Id` / `<Entity>IdSchema`, `<Entity>Name` / `<Entity>NameSchema` |
| combined error union | `<Entity>Error` (from `application/<entity>-public.ts`) |
| compose function | `compose<Entity>Module` |
| module options | `<Entity>ModuleOptions` |
| module result type | `<Entity>Module` |
| DB factory | `openDb` from `infrastructure/drizzle/<entity>-db.ts` (package-private) |

### Internal types (NOT exported)

| concept | name |
| ------- | ---- |
| Drizzle row / insert row | `<Entity>Row` / `New<Entity>Row` |
| entity class | `<Entity>Entity` |
| bound mapper | `<Entity>Mapper` |
| write repository (port / impl) | `<Entity>Repository` / `Drizzle<Entity>Repository` |
| read queries (seam / impl) | `<Entity>Queries` / `Drizzle<Entity>Queries` |

NEVER use these suffixes:
- `Manager` — use a use-case class or a named port.
- `Service` — there is no per-BC service facade; expose use-cases.
- `View` / `Pojo` / `Dto` — use the use-case `Response` type.

## Parameter & constructor shape

> **Identity is positional; payload is an object; wiring is always an object.**

### Positional vs object

Pass **positional** parameters for:

- A single identifying primitive — almost always an `id` (or a path /
  name acting as a key): `get(id)`, `delete(id)`, `findByPath(dir)`.
- A second positional only when it too is a required *locating* primitive
  and the order is unambiguous: `resolveArtifactPath(id, name)`.
- A pure function / projection / factory's single argument:
  `projectWorkspace(entity)`, `workspaceLayout(dir)`, `openDb(dbFile)`.

Pass a **single trailing object** for everything else — and always when
the parameter is or contains a multi-field payload, an optional / filter
/ config field (defaulted `= {}`), a partial-update set, or a boolean
flag (`delete(id, { purge: true })`).

The idiom is **`method(id, <object>)`**: identity rides positionally,
everything else rides in one object.

### Name the object by its role

| param | role | type |
|---|---|---|
| `input` | the operation's request body, shared verbatim with the HTTP route | `*Request` |
| `opts` | optional config / filtering, and a class's bundled dependencies | `*Opts` |
| `deps` | a function's injected, test-swappable collaborators (defaulted to real impls) | `*Deps` |
| `patch` | a repository partial update | `Partial<Pick<*Entity, …>>` |
| `entity` | a repository write of a full domain entity | `*Entity` |

`input` carries an operation's wire request body. `opts` carries
configuration plus, for a class, the dependency bag the composition root
assembles once (`constructor(opts: <Name>Opts)`).

`deps` is the separate bag a stateless *function* takes for its injected,
side-effecting collaborators — `spawn`, `exists`, a clock — defaulted to
real implementations so production omits it and tests pass fakes
(`spawnTerminalWith(cmd, deps)`, `launchCopilotHeadless(opts, deps)`). A
constructor bundles config + deps into its one `opts` (assembled once); a
function splits `opts` (per-call config) from `deps` (fixed injected
collaborators).

### Identity stays out of the body

The resource `id` is a positional argument mirroring the URL path param;
the `*Request` body holds only payload fields and never repeats the `id`:

- existing resource → `verb(id, input)`: `rename(id, input)`,
  `unregister(id, input = {})`.
- server-minted id → `verb(input)`: `register(input)`.
- id-only operation → `verb(id)`: `open(id)`, `get(id)`, `delete(id)`.

Path params are their own wire type (`*PathParams`), held separate from
the `*Request` body.

### Constructors take one named-deps object

Every use-case, `*Repository`, `*Queries`, and anything assembled in
`<entity>-module.ts` takes exactly one named object —
`constructor(opts: <Name>Deps)` — even for a single dependency:

```ts
constructor(opts: { db: Db }) { this.db = opts.db; }        // repository, 1 dep
constructor(opts: RegisterWorkspaceDeps) { /* … */ }        // use-case, N deps
```

A new dependency joins as a named field without reshuffling call sites,
and tests override deps by name
(`new RegisterWorkspaceUseCase({ ...deps, provisioner })`). The `*Deps`
type is the use-case's injection contract.

The composition-root factory `compose*Module` takes its single argument
as `*ModuleOptions` (`composeWorkspaceModule(opts: WorkspaceModuleOptions)`)
— the fuller-word name used uniformly across every package's `compose.ts`.

This does not apply to discriminated-union error atoms (plain
`{ type, … }` object literals — no constructor) or to value objects
(branded zod schemas). A rare error that must be a `class` follows the
native `Error` positional shape.

### At the contract boundary

A use-case's `execute()` presents the object-first shape outward:

- it accepts exactly one `request: <Verb><Entity>Request` — an
  identifying `id` rides as a field of the request, not a separate
  positional — parsed through `<Verb><Entity>RequestSchema` on entry.
- it returns `UseCaseResult<<Verb><Entity>Response, <Verb><Entity>Error>`
  (a `ResultAsync`); a read whose row is absent returns a nullable
  `Response`.

A public boundary method never takes multiple parallel primitives, a bare
boolean, or a `*Row`.

## Wire / HTTP layer conventions

> Applies to `@glyphs-ai/api`'s `wire/` surface — the wire / HTTP layer.
> The `## Naming conventions` rules above govern *pkg-internal* types
> (`*Row` / `*Entity` / use-case `Request` / `Response`). This section
> governs the *cross-the-wire* types that live under
> `packages/api/src/wire/`: HTTP request / response bodies and the
> per-endpoint projections of pkg types.

The wire surface is **only** JSON-over-HTTP. Four rules govern wire type
names:

### Rule 1 — Same shape as the owning pkg DTO → re-export, don't redefine

When a wire type is structurally identical to a DTO already owned by a
domain pkg, **re-export it** instead of hand-copying a second
definition.

```ts
// packages/api/src/wire/workflows.ts
import type {
  WorkflowStatus,
  WorkflowSuccess,
} from "@glyphs-ai/workflow";

export type { WorkflowStatus, WorkflowSuccess } from "@glyphs-ai/workflow";
```

Re-export keeps the wire layer DRY and turns any drift in the owning
pkg into a `tsc` error here, immediately. A second `interface
Workflow` in the wire surface that is byte-identical to the pkg DTO is the
anti-pattern (`WorkflowStatusWire = "running" | …` vs the pkg's
`WorkflowStatus` — two names for exactly one thing). All re-exports are
`type`-only, so no runtime dep crosses into the dashboard / CLI
bundles.

### Rule 2 — Different shape (subset / extension / projection) → descriptive suffix, never `Wire`

When the wire shape is a projection — a trimmed list row, a denormed
snapshot, a flattened envelope — give it a name that states the
*intent*, never a `Wire` tag.

| Use case | Suffix | Example |
|---|---|---|
| List / summary row (trimmed) | `Header` | `WorkflowHeader`, `ScheduleHeader` |
| Full detail (when it differs from the list row) | `Detail` | `WorkflowDetail` |
| Endpoint-specific projection | concrete noun | `WorkflowDag`, `WorkflowNode`, `WorkflowEdge` |
| Terminal / outcome payload | the concept | `WorkflowSuccess`, `WorkflowFailure`, `WorkflowCancellation` |
| Polymorphic spec union | concept (+ subtype on the arms) | `WorkflowNodeSpec` |

```ts
// Wire projection of a workflow header — mirrors WorkflowEntity but
// adds awaitingHumanCount and drops pkg-private columns.
export interface WorkflowHeader {
  readonly id: string;
  readonly status: WorkflowStatus; // re-exported per Rule 1
  readonly awaitingHumanCount: number;
  // …
}
```

`WorkflowHeader` tells a reader it is the list / summary projection.
`WorkflowHeaderWire` told them nothing — not whether it was a list row,
a detail, or a request body.

### Rule 3 — Request / response bodies → `*Request` / `*Response` (full word, no `Req` / `Res`)

HTTP bodies are named for their direction with the full word — never
the `Req` / `Res` abbreviations.

```ts
export interface AddNodeRequest {
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
  readonly parents: readonly string[];
}

export interface AddNodeResponse {
  readonly nodeId: string;
  readonly phase: number;
}
```

This aligns with the route manifest's `RouteReq<K>` / `RouteRes<K>`
roots and the standard `*Request` / `*Response` HTTP convention. A request
body that re-uses a re-exported pkg DTO unchanged still follows Rule 1
(re-export); `*Request` / `*Response` is for bodies that have their own
shape.

### Rule 4 — Nested sub-structures → flat naming, repo-wide

A type nested inside a request / response body is named by
concatenating its parent's name with its role — **flat**, no TypeScript
`namespace`. Pick one style and keep it repo-wide; glyph uses flat.

```ts
export interface AddSubgraphRequest {
  readonly nodes: readonly AddSubgraphRequestNode[];
  readonly edges: readonly AddSubgraphRequestEdge[];
}

export interface AddSubgraphRequestNode {
  readonly tempId: string;
  readonly kind: WorkflowNodeKind;
  readonly spec: unknown;
}

export interface AddSubgraphResponse {
  readonly insertedNodes: readonly AddSubgraphResponseInsertedNode[];
}
```

Flat names keep every wire type reachable by a single `grep` and avoid
the `Parent.Child` import friction a `namespace` introduces.

## Repository contract

> glyph uses an explicit Row → Entity split for write operations and a
> Row → read-projection split for flexible reads.

### The layers

| Layer | Lives in | Visibility | Role |
|---|---|---|---|
| **Row** | `infrastructure/drizzle/<entity>-schema.ts` (`$inferSelect` / `$inferInsert`) | pkg-private; mapper-internal | Drizzle table shape; used only inside the mapper to convert to/from the entity |
| **Entity** | `domain/<entity>-entity.ts` | pkg-owned (never re-exported from `index.ts`) | A `class` with private mutable state; transitions return `Result`. Never an alias of the row |
| **Read projection** | per-use-case `application/<use-case>.ts` (`Response` schema) | exported via `index.ts` | Shaped directly from query rows; each read use-case projects its own `SELECT` result |

### The boundary rule (hard)

> **The repository is the write-side adapter.** Its public methods speak only
> domain `<Entity>Entity` and primitive ids. The repository exposes exactly
> **three methods**: `get` / `save` / `delete`. The Row type NEVER appears in a
> public signature — the bound mapper handles the conversion internally.
>
> **Reads do NOT go through the repository.** Read use-cases depend on the
> `<Entity>Queries` seam (`infrastructure/drizzle/<entity>-queries.ts`), which
> returns raw rows the use-case projects to its own `Response` type.

### The bound mapper

`infrastructure/drizzle/<entity>-mapper.ts` owns the bidirectional row ↔
entity conversion, keeping mapping logic out of both the repository and the
domain:

```typescript
// infrastructure/drizzle/<entity>-mapper.ts
export const <Entity>Mapper = {
  toDomain(row: <Entity>Row): <Entity>Entity {
    return new <Entity>Entity({
      id: row.id as <Entity>Id,
      name: row.name as <Entity>Name,
      createdAt: row.createdAt,
      archived: row.archived,
    });
  },
  toRow(entity: <Entity>Entity): <Entity>Row {
    return { id: entity.id, name: entity.name, createdAt: entity.createdAt, archived: entity.archived };
  },
} as const;
```

The repository's `get` calls `<Entity>Mapper.toDomain(row)` on the way out;
`save` calls `<Entity>Mapper.toRow(entity)` on the way in.

### Rich entity = class with private fields + Result-returning transitions

The entity is always a `class`. Private mutable fields are mutated only
through entity methods; each transition that can fail returns `Result`:

```typescript
// domain/<entity>-entity.ts
archive(): Result<void, <Entity>AlreadyArchived> {
  if (this._archived) return err({ type: "<Entity>AlreadyArchived", id: this.id });
  this._archived = true;
  return ok(undefined);
}
```

The application layer never writes entity fields directly — it calls the
entity method and propagates the `Result`.

### Read use-case: using the queries seam

A read use-case receives `<Entity>Queries` and composes its own SELECT,
projecting directly from the raw row:

```typescript
// application/get-<entity>.ts
execute(request: Get<Entity>Request): UseCaseResult<Get<Entity>Response, Get<Entity>Error> {
  const { id } = Get<Entity>RequestSchema.parse(request);
  const q = this.deps.query;
  return q.query<Get<Entity>Response>(async (db) => {
    const row = await db.select().from(q.<entities>).where(eq(q.<entities>.id, id)).get();
    return row
      ? { id: row.id as <Entity>Id, name: row.name as <Entity>Name, createdAt: row.createdAt, archived: row.archived }
      : null;
  });
}
```

The row is projected to the use-case's `Response` here; the domain entity
is not involved in reads.

## Use-cases, not a service facade

There is no single service facade class per BC. Every BC exposes one
**use-case class per operation** in `application/` — `Create<Entity>UseCase`,
`Get<Entity>UseCase`, `Archive<Entity>UseCase`, `List<Entity>sUseCase` — each
owning its own `Request`/`Response` zod schema and `Error` union. The
`compose<Entity>Module` function assembles them into a DI container that
external callers receive.

Consumers call `module.<useCase>.execute(request)` and handle the
`ResultAsync` it returns. There is no shared service state and no shared DTO
schema across use-cases.

If a downstream package only needs a narrow subset of capabilities, declare a
small **capability interface** (port) in the downstream package and depend on
that, rather than importing the whole module type:

```typescript
// packages/runtime/src/types.ts — minimal surface for "resolve an agent"
export interface AgentContentSource {
  resolveAgent(fqn: string): Promise<AgentResolveResult>;
  // ... 3 more methods, total 4
}
```

The downstream package accepts `AgentContentSource`; the composition root
passes an adapter that structurally implements the interface. This is a real
example from `@glyphs-ai/runtime`.

## Composition root

`compose<Entity>Module({ dbFile })` in `<entity>-module.ts` is the single
assembly point for the package. It:

1. opens the SQLite database with `openDb(dbFile)` (WAL + migrations applied);
2. builds the write-side `Drizzle<Entity>Repository` and the read-side
   `Drizzle<Entity>Queries` adapters;
3. wires each use-case with only the deps it needs — `repo` for write
   use-cases, `query` for read use-cases;
4. returns a `<Entity>Module` DI container:
   `{ create<Entity>, get<Entity>, archive<Entity>, list<Entity>s, close }`.

External callers receive use-cases, not a service facade. They invoke
`module.<useCase>.execute(request)` and never interact with the DB handle or
repositories directly. Tests pass `dbFile: ":memory:"` to get an in-memory
database running the production schema.

## Errors

All domain and application errors are **discriminated-union atoms** that flow
through neverthrow `Result` / `ResultAsync` — they are never thrown for control
flow and have no class hierarchy.

```typescript
// domain/<entity>-repository.ts — repository error atoms
export type DatabaseUnavailable = {
  readonly type: "DatabaseUnavailable";
  readonly cause: unknown;
};

export type <Entity>NotFound = {
  readonly type: "<Entity>NotFound";
  readonly id: <Entity>Id;
};
```

Three tiers:

1. **Domain atoms** — declared in `domain/<entity>-entity.ts` (state-transition
   failures) or `domain/<entity>-repository.ts` (port errors). These represent
   legitimate business outcomes callers must handle.
2. **Technical fault** — `DatabaseUnavailable` is the one atom infrastructure
   adapters produce when a driver throws. Only the infrastructure layer catches
   third-party throws and converts them; domain and application never throw or
   catch for control flow.
3. **Request validation** — each use-case's `execute()` parses its zod
   `RequestSchema` on entry; malformed input throws `ZodError`, which the
   api/server boundary maps to HTTP 400. `ZodError` is not an application error
   atom.

Each use-case declares its own closed `Error` union:

```typescript
// application/archive-<entity>.ts
export type Archive<Entity>Error = <Entity>AlreadyArchived | <Entity>NotFound | DatabaseUnavailable;
```

`application/<entity>-public.ts` re-exports the closed `<Entity>Error` union
(all atoms combined) for consumers that handle any error from any use-case.

Consumers branch on `err.type`, never `instanceof`:

```typescript
result.match(
  (response) => { /* success */ },
  (err) => {
    switch (err.type) {
      case "<Entity>NotFound":    return respond(404, err);
      case "DatabaseUnavailable": return respond(503, err);
    }
  },
);
```

The api/server boundary maps each atom to an HTTP status.

### Catch-block error normalization (inline only)

Do NOT create `src/utils/errors.ts` or any helper file for catch-block
error normalization (`errorMessage`, `isAbortError`, etc.). Use the
inline form at each `catch (e) { ... }` site:

```ts
const msg = e instanceof Error ? e.message : String(e);
```

For abort-error detection:

```ts
if (e instanceof Error && e.name === "AbortError") return;
```

Keep these checks inline at each catch site, in the layer that owns them.
Backend packages have no generic `src/utils/` bucket.

## Migrations

Drizzle migrations live under `drizzle/` and are committed. To
regenerate after a table-definition change:

```sh
pnpm -F @glyphs-ai/<pkg> db:generate
```

`drizzle.config.ts` points `schema:` at
`./src/infrastructure/drizzle/<entity>-schema.ts`.
After drizzle-kit writes a new `drizzle/NNNN_*.sql`,
`scripts/inline-migrations.mjs` regenerates
`src/infrastructure/drizzle/<entity>-migrations.ts` so the SQL is embedded into
the runtime bundle. The package's `db:generate` script runs both steps.

The generated migrations file is not hand-maintained:

```ts
// src/infrastructure/drizzle/<entity>-migrations.ts — generated by scripts/inline-migrations.mjs
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { MigrationMeta } from "drizzle-orm/migrator";

export const MIGRATIONS: readonly MigrationMeta[] = [
  // generated entries...
];

export function applyXxxMigrations<T extends Record<string, unknown>>(
  db: BetterSQLite3Database<T>,
): void {
  // generated migration applier
}
```

At runtime, `infrastructure/drizzle/<entity>-db.ts` calls the generated applier
from `openDb(dbFile)`, walking migrations in order and recording them in the
pkg's `__drizzle_migrations_<pkg>` table. SQL is embedded as strings in
the JS bundle — no filesystem reads at runtime. The same `openDb` path is
used by tests with `":memory:"`, so in-memory DBs see the production
schema.

## Splitting big files via facade + sibling subdir

### When to split

Default: keep one file per concern. Split a single file ONLY when BOTH
conditions hold:

1. The file is **≥ 600 LOC**.
2. The file genuinely contains **≥ 3 cohesive sub-concerns** (e.g. queries vs
   mutations vs lifecycle vs streaming).

A pure 800-LOC module (one concern) does NOT split. A 400-LOC file touching 5
concerns does NOT split (too small). A 700-LOC module with reads / writes /
lifecycle / streaming DOES split.

Use-cases in `application/` are already one file per concern, so the split
pattern applies most often to large infrastructure modules or cross-entity
orchestration helpers, not to individual use-case files.

### Layout: facade + sibling subdir

```
packages/<pkg>/src/<layer>/
  <file>.ts                ← facade (public entry, ≤ ~250 LOC)
  <file>/                  ← sibling subdir; basename MUST equal facade basename
    <concern-1>.ts         ← bare concern name; no extra prefix needed
    <concern-2>.ts
    …
```

See [§ Package-private utility files](#package-private-utility-files) for the
`_` convention — delegates inside the subdir that are not meant to be reached
even by the parent facade use the `_<topic>.ts` prefix.

### Hard rules

> **Scope.** These rules apply ONLY when a subdir has a sibling `.ts` / `.tsx`
> file at the parent level (the SPLIT pattern). Subdirs without a sibling file
> (CATEGORY dirs — e.g. `packages/catalog/src/agent/`,
> `packages/catalog/src/facade/`, `packages/server/src/routes/`) are a
> separate, pre-existing organisational pattern and are unaffected by these
> rules; they MAY contain an `index.ts` barrel and follow the multi-entity /
> per-route conventions documented elsewhere on this page.

1. **Subdir basename equals facade basename AND is a direct sibling.** `example.ts` ↔ `example/` in the same directory. Enforced mechanically — see the structural test in `packages/e2e/test/architecture/split-convention.test.ts`. The subdir MUST sit next to its facade; a subdir at any other path is not a recognised SPLIT.
2. **No barrel re-export** inside the subdir (no `example/index.ts`). The facade composes via direct relative imports (`./example/queries.js` etc.). Enforced by the same structural test.
3. **Subdir files are package-private.** They MUST NOT appear in the package's top-level `src/index.ts` barrel. The facade is the only public surface.
4. **Concern files use bare names** (`queries.ts`, `mutations.ts`, `shutdown.ts`) — the subdir name already supplies context. Do NOT re-prefix with the parent file name.
5. **Each concern file ≤ ~450 LOC.** If a single concern grows beyond that, decompose it further — but always keep at one level of nesting.
6. **Facade stays ≤ ~250 LOC** and contains only: constructor, ctx-object construction, and 1-line delegates to internals.
7. **Shared context.** The facade builds a context object once and passes it to every internal — no field-visibility widening. Each internal exports plain functions taking `(ctx, …args)` OR a small object that consumes ctx.

A `_helpers.ts` file inside the subdir demonstrates the package-private utility
seam: extract a helper there when **the same logic appears in two or more
concern files**. The leading `_` on the filename is the same "package-private
utility" signal as the top-level `_shared.ts` files cited under
"When NOT to use this pattern" below. If a helper is used inside only one
concern, keep it private to that concern instead.

### When NOT to use this pattern

- **Cross-entity shared infrastructure** → use a `_shared.ts` file (or a `_*` subdir) — the structural test skips any directory whose name starts with `_`, and treats `_`-prefixed files as ordinary peer modules outside any SPLIT registry.
- **Component organisation** (e.g. a page + its sub-components) → `packages/dashboard/src/components/tasks/TaskDetail.tsx` + `TaskDetail/` already does this; it is a related but distinct pattern. The same structural rules (no `index.tsx` barrel, exact-case sibling) apply.
- **Different concerns belonging to different files** in the same package → keep them as separate top-level files in the appropriate layer.

### Migration of existing big files

Pre-existing big files do NOT need preemptive splitting. Apply this convention
WHEN a refactor of that file is otherwise needed (e.g. a feature change, a bug
fix that touches many sections, an audit-flagged improvement).

**Registry maintenance (mandatory).** When you split a previously-flat file
under this convention, also update
`packages/e2e/test/architecture/split-convention.test.ts`:

- Add the new subdir's repo-relative path to `REQUIRED_SPLITS` so future PRs cannot silently delete the facade (the structural test asserts every entry still classifies as SPLIT). If you remove or collapse a SPLIT, drop the entry in the same PR — the test treats `REQUIRED_SPLITS` as the *exact* set of on-disk SPLITs and will fail on either drift direction.
- Remove the subdir from `EXPECTED_CATEGORY_DIRS_AT_CONVENTION_INTRODUCTION` if it was previously a CATEGORY (the SPLIT promotion turns the same path into a SPLIT, so leaving it in the snapshot would trip the "must still be CATEGORY" assertion).

The two registries together are the mechanical record of every applied SPLIT and every surveyed CATEGORY; they must move in lock-step with the source tree.

## Optional patterns

The standard skeleton above covers a single-entity BC with no extra
concerns. The patterns below appear in some real packages and are
documented here so newcomers know when and how to add them. **Do not
copy them into a new package unless the package actually needs them.**

### Filesystem-owning BCs → `paths.ts`

If the BC owns a directory layout under a root the composer hands it
(e.g. a package owns subdirectories under a workspace root), add a small
layer-local `paths.ts` that centralizes the path math:

```typescript
// src/infrastructure/<entity>-paths.ts — the layer that owns the path math
import path from "node:path";

export function xxxDir(root: string, id: string): string {
  // SECURITY: refuses ids that try to escape via "..", absolute paths, etc.
  return safeJoinUnderRoot(root, id);
}

export function safeJoinUnderRoot(root: string, ...parts: string[]): string {
  // ... implementation
}
```

The service imports from the layer-local helper instead of doing
`path.join` inline. Existing filesystem-owning BCs may still be
mid-migration; new packages should keep path helpers in the layer that
owns the invariant rather than adding a cross-package helper.

**Each filesystem-owning BC keeps its own copy of `safeJoinUnderRoot`.**
The guard is a few lines of security-critical path math and each BC owns
its own root invariant; keep the copies in lockstep and do not reach
across BCs for it.

### Multi-entity BCs → domain/application/infrastructure layers, entities namespaced by file prefix

A BC that owns more than one rich entity participating in cross-entity
orchestration (catalog owns Agent + Skill + Mcp) keeps the SAME top-level
domain/application/infrastructure layers as a single-entity package. Entities
are namespaced inside each layer by the `<entity>-` file prefix — there is no
per-entity subtree (`agent/domain/…`). The hyphen-separated prefix (see § File
naming convention) already makes every file's class location unique.

```
src/
  index.ts                       public barrel (use-cases + compose + value objects; no export *)
  catalog-module.ts              composeCatalogModule({ ... })

  domain/
    agent-entity.ts              AgentEntity (internal; skill / mcp mirror)
    agent-id.ts                  AgentId value object (skill / mcp mirror)
    agent-repository.ts          write-side repo port (skill / mcp mirror)
    agent-frontmatter.ts         entity-specific codec (mcp.format.ts, …)
    catalog-dep-keys.ts          cross-entity domain helpers (origin grammar, …)

  application/
    use-case.ts
    catalog-public.ts            named re-exports of cross-entity domain symbols
    create-agent.ts              per-entity write use-cases (skill / mcp mirror)
    get-agent.ts                 per-entity read use-cases (skill / mcp mirror)
    list-agents.ts               per-entity list use-cases (skill / mcp mirror)
    catalog-projection.ts        cross-entity orchestration helpers (plan-types, pipeline, …)

  infrastructure/drizzle/
    catalog-schema.ts            all table definitions + Row types
    catalog-db.ts                openDb / Db type
    catalog-migrations.ts        generated migration bundle
    agent-mapper.ts              row ↔ entity mapper (skill / mcp mirror)
    agent-repository.ts          write-side Drizzle adapter (skill / mcp mirror)
    agent-queries.ts             read-side query seam (skill / mcp mirror)
```

Naming follows one rule: cross-entity files take the bare-noun `catalog-`
aggregate prefix (`catalog-module`, `catalog-projection`, `catalog-dep-keys`);
per-entity files take the `agent-` / `skill-` / `mcp-` prefix.

Per-entity use-case classes are **internal** to the BC when not directly useful
to external callers. External callers reach the BC through the
`compose<Catalog>Module` container and the per-use-case request/response types
exported from `index.ts`.

An outbound infrastructure adapter that belongs to none of the three layers
(catalog's content `fetcher/` — origin URI → bytes) stays in its own
top-level dir, a peer of `infrastructure/`.

### Test seams (clock, randomness)

A use-case or the compose function accepts an optional
`{ now?: () => Date; randomBytes?: (n: number) => Buffer }` seam when it
touches the clock or generates ids. Pass fakes from tests; production
callers omit the opts to get the real ones.

