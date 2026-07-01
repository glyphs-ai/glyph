# Service package template

This document describes the standard layout every BC-owning service
package in glyph follows.

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
drizzle-kit can regenerate it from `src/persistence/tables.ts`. The
result is a four-layer package with a main entry (`.`) and a declaration
entry (`./contract`).

## Layout

```
packages/<pkg>/
  src/
    index.ts                         main barrel: service + compose only
    <entity>.compose.ts              compose<Entity>Module({ dbFile, now? })

    contract/                        published declaration surface (`./contract`)
      <entity>.schemas.ts            zod schemas: scalar, request, response
      <entity>.types.ts              public types inferred with z.infer
      <entity>.errors.ts             public error classes
      index.ts                       contract barrel

    domain/
      <entity>.entity.ts             pkg-owned domain shape (hand interface / class)

    application/
      <entity>.service.ts            single public service; reads + writes

    persistence/
      tables.ts                      Drizzle table defs and private row types
      migrations.ts                  generated migration bundle
      <entity>.db.ts                 openDb(dbFile): prod + test DB factory
      <entity>.repository.ts         Drizzle CRUD (PRIVATE)

  drizzle/                           generated SQL migrations (committed)
  drizzle.config.ts                  points at ./src/persistence/tables.ts
  package.json                       depends on better-sqlite3 + drizzle-orm + zod
  tsconfig.json                      extends ../../tsconfig.base.json
  tsconfig.typecheck.json            typecheck-only config covering src/ + test/
  vitest.config.ts
```

`index.ts` intentionally exports only the service, the compose function,
and the module option/result types. Schemas, DTO types, and errors are
exported from `@glyphs-ai/<pkg>/contract`. Persistence, domain entities,
and row types are package-private implementation details.

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

Every `packages/<pkg>/test/**/*.test.{ts,tsx}` file's location is
determined mechanically by its source imports. Enforced by
`packages/e2e/test/architecture/test-layout-convention.test.ts`.

**The rule**: for each test file, collect every non-type value-import
that resolves to a file under the same package's `src/` tree (resolve
relative to the test file's directory; exclude type-only imports,
`vi.mock(...)`, `vi.importActual(...)`, and imports of other workspace
packages or node builtins). **Demote `src/domain/` imports**: domain
entities and value objects are the package's foundational kernel that
any layer's test legitimately constructs as input data, so they do not
locate a test unless they are *all* it imports. The locating set is the
non-`domain/` imports when any exist, else the domain imports.

1. **Zero locating imports** → flat at `test/<name>.test.{ts,tsx}`
   (cross-cutting / e2e / fs-walk audits).
2. **All locating imports share a common subdirectory under `src/`
   strictly deeper than `src/` itself** → MUST live at
   `test/<that-subdir>/<name>.test.{ts,tsx}`.
3. **Multiple locating imports with no common subdir below `src/`** →
   flat at `test/<name>.test.{ts,tsx}`.

So a use-case test importing its use-case from `application/<group>/`
plus domain entities lives at `test/application/<group>/` (the domain
imports are demoted), while a pure domain unit test that imports only
domain lives at `test/domain/`. The walk over `test/` does not skip a
`drizzle` directory (that skip targets the generated `drizzle/*.sql`
migrations under the package root, not `test/infrastructure/drizzle/`).

Type-only imports (`import type { Foo } from "..."` and the `type`
modifier inside mixed `import { type Foo, bar }` specifiers) compile
away and do NOT count. `vi.mock("...")` and `vi.importActual("...")`
are harness, not subject, and do NOT count. Side-effect-only
`import "x"` DOES count — it executes top-level code.

**When source moves, tests move.** If `src/application/x.ts` is relocated
to `src/domain/x.ts`, the rule's verdict changes and the test must be
relocated in the same PR. The enforcement test fails until both
halves are in sync.

**Allowlisting**: a test whose actual location diverges from the
rule's required location but has a documented reason (umbrella
reflection test, in-flight migration, pre-existing per-area subdir
whose imports happen to span sibling top-level src files) may be
added to `ALLOWED_FLAT_EXCEPTIONS` with a one-line rationale. The
audit asserts the allowlist contains no stale entries (file gone) and
no idle entries (cases where the rule would now pass without an exception).

For worked-out classification examples and the parser self-tests, see
`packages/e2e/test/architecture/test-layout-convention.test.ts`.

## Test file naming

Test files mirror the source file they test, with `.test.ts` appended.
Large suites split by feature with a `.<feature>` infix.

| source | test |
| ------ | ---- |
| `application/<entity>.service.ts` | `test/application/<entity>.service.test.ts` |
| `application/<entity>.service.ts` (per-feature suite) | `test/application/<entity>.service.<feature>.test.ts` |
| `persistence/<entity>.repository.ts` | `test/persistence/<entity>.repository.test.ts` |
| `persistence/<entity>.repository.ts` (per-feature) | `test/persistence/<entity>.repository.<feature>.test.ts` |
| `domain/<entity>.entity.ts` | `test/domain/<entity>.entity.test.ts` |
| `contract/<entity>.schemas.ts` | `test/contract/<entity>.schemas.test.ts` |
| `<entity>.compose.ts` | `test/<entity>.compose.test.ts` |

A single source class may have several test files, split by feature or
scenario:
- `<entity>.service.<feature>.test.ts` — per-feature splits of a service.
- `<entity>.repository.<scenario>.test.ts` — per-scenario splits of a
  repository.

Tests under a sub-folder mirror the source sub-folder:
`src/application/<entity>.service.ts` → `test/application/<entity>.service.test.ts`.

NEVER name a test file by an old class name or a non-source concept
word.

## Public API guard

Every pkg ships a `test/public-api-guard.test.ts` that uses Vitest's
`expectTypeOf` to lock the pkg's public surface at typecheck time.
The test:

- Asserts every method on the public service class exists by name.
- Asserts every declared error class is exported and constructible from the `./contract` subpath.
- Asserts every public schema and DTO / interface shape.
- Asserts the main entry exports the service and composition surface, not persistence internals.

`expectTypeOf` catches silent renames or signature changes at
`pnpm typecheck` time, before downstream pkgs surface the breakage. As a
type-only assertion it costs nothing at runtime.

When a public method, error class, schema, or DTO is added / renamed / removed,
the guard test fails until updated in the SAME PR — review enforces
the coupling.

## File naming convention

**Domain / role files use a dot prefix:** `<entity>.<role>.ts`. The dot
separates the aggregate facet from the role facet:

| file pattern | exports |
|---|---|
| `application/<entity>.service.ts` | `<Entity>Service` |
| `persistence/<entity>.repository.ts` | `<Entity>Repository` |
| `domain/<entity>.entity.ts` | `<Entity>Entity` |
| `contract/<entity>.schemas.ts` | `<Entity>Schema`, `<Entity>IdSchema`, operation schemas |
| `contract/<entity>.types.ts` | `z.infer` public types |
| `contract/<entity>.errors.ts` | `<Entity>Error` and subclasses |
| `<entity>.compose.ts` | `compose<Entity>Module` |
| `persistence/<entity>.db.ts` | `openDb` and `Db` |

Multiword facets use hyphens inside the facet, Twenty-style, e.g.
`task.workspace-entity` facet file. Test files mirror the same pattern:
`<entity>.<role>.test.ts` and `<entity>.<role>.<feature>.test.ts`.

The layer directory also namespaces files, but the per-file aggregate
prefix is still required. A repo-wide Ctrl-P for `workspace.service` or
`workspace.repository` must be unique across the sibling domain packages.

**Tooling-locked bare names** are exempt from the dot-prefix rule:

- `index.ts` — barrels.
- `tables.ts` — `drizzle.config.ts` references
  `./src/persistence/tables.ts` by path.
- `migrations.ts` — `scripts/inline-migrations.mjs` writes this file.
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
`contract/<entity>.types.ts` for broadly-public types — reach for a
named const re-export from a `_` module only when the const is
inseparable from the internal concern that owns it.

Tests for `_` files live alongside the helper they cover
(`test/application/_helpers.test.ts` is a valid layout per § "Test
layout convention" rule 2).

## Where DTOs live

> See [docs/architecture.md § The three layers](./architecture.md#the-three-layers) for the Row / Entity / DTO split that motivates the contract-surface rule.

**ALL public declaration types — DTOs, operation request shapes,
response shapes, option shapes, enums, and union types — live in
`src/contract/<entity>.types.ts`, inferred from schemas where possible.**
Every service package has one contract types file, regardless of size.

The corresponding zod schemas live in `src/contract/<entity>.schemas.ts`:
reusable scalar schemas (`<Entity>IdSchema`, `<Entity>NameSchema`), one
input schema per write operation (for example
`Create<Entity>RequestSchema`), and response / projection schemas (for
example `<Entity>Schema`). Schemas are the single source of truth for
runtime input validation, inferred types, and — when exposed over HTTP —
the OpenAPI projection.

Other files must NOT `export interface` or `export type`
consumer-facing types. The exceptions are:
- `src/persistence/tables.ts` MAY define `<Entity>Row` /
  `New<Entity>Row` for the repository's own row ↔ entity mapping, but
  those types are **persistence-private** — never re-exported from
  `index.ts` or `./contract`, and never used in a repository's public
  signature (which speaks `<Entity>Entity`). Anemic BCs whose mapping is
  structural usually omit them entirely.
- `src/contract/<entity>.errors.ts` exports Error subclasses (classes are
  values, not pure types).
- `src/domain/<entity>.entity.ts` exports the domain Entity type or class,
  but only for package-internal use.
- Multi-entity BCs' facade-internal type files may export internal types.
- Capability-interface seams are declared by the consumer package when a
  downstream needs a narrow surface (for example `AgentResolverPort` or
  `SpawnFn`). The port surface is a cross-pkg seam, distinct from runtime
  DTOs that flow over HTTP or through the service.
- `<entity>.compose.ts` MAY export `<Entity>Module` and
  `<Entity>ModuleOptions` alongside `compose<Entity>Module`. These are
  composition surface (how downstream packages WIRE the pkg), distinct
  from runtime DTOs (what flows over HTTP / through the service).

Every public type has exactly one home — `contract/<entity>.types.ts`.
Every pkg, single-entity or multi-entity, uses the same contract surface
shape.

## Type placement (which package owns this type?)

> See [docs/architecture.md § The three layers](./architecture.md#the-three-layers) for the Row / Entity / DTO split inside one package. This section covers the orthogonal question: *which package* should host a given type.

The "Where DTOs live" section above governs *intra-package* type layout
(`contract/<entity>.types.ts` per entity). This section governs
*inter-package* type layout — given a new type, which of glyph's type-owning
location kinds should host it.

| Kind of type | Lives in | One-line test |
|---|---|---|
| A single BC's entity / DTO / error / option shape | the owning domain pkg's `domain/<entity>.entity.ts` / `contract/<entity>.types.ts` / `contract/<entity>.errors.ts` | "Does it belong to one BC only? Would you delete it if you deleted that BC?" |
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

- **Errors that cross the wire.** If an error name appears in an HTTP
  error response (i.e. the client branches on it), its `name` literal
  is wire-shape and should be re-declared in the api `wire/` surface. The
  Error *class* stays in the domain pkg's contract errors file. Cross-pkg
  consumers that need to discriminate the error should branch on
  `err.name === "AgentNotFoundError"` rather than `import`ing the
  class for `instanceof` — the latter introduces a runtime cross-BC
  dep that rule 4 forbids.

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
  class — silently builds a runtime cross-BC dep. **Fix:** use
  `import type`; thread the live instance through `@glyphs-ai/api`'s
  composer; for cross-BC error discrimination, branch on `err.name`
  instead of `instanceof`. Mechanically audited by
  `inter-service-imports.test.ts`.

## Naming conventions

> See [docs/architecture.md § Coding conventions](./architecture.md#coding-conventions) for the full rationale.

### Public types and values

| concept | name / surface |
| ------- | -------------- |
| package name | `@glyphs-ai/<pkg>` |
| main entry | `@glyphs-ai/<pkg>`: service + compose only |
| contract entry | `@glyphs-ai/<pkg>/contract`: schemas + inferred types + errors |
| **DTO** (wire shape) | `<Entity>` — bare noun |
| list entry | `<Entity>Entry` (only if it differs from DTO) |
| operation request | `<Verb><Entity>Request` |
| operation response | `<Verb><Entity>Response` |
| reusable scalar schema | `<Entity>IdSchema`, `<Entity>NameSchema` |
| DTO schema | `<Entity>Schema` |
| write+read surface | `<Entity>Service` |
| service dependencies | `<Entity>ServiceOpts` (constructor opts; see "Parameter & constructor shape") |
| compose function | `compose<Entity>Module` |
| module options | `<Entity>ModuleOptions` |
| module result type | `<Entity>Module` |
| DB factory | `openDb` from `persistence/<entity>.db.ts` (package-private) |

### Internal types (NOT exported)

| concept | name |
| ------- | ---- |
| Drizzle row | `<Entity>Row` |
| Drizzle insert row | `New<Entity>Row` |
| repository class | `<Entity>Repository` |
| entity type/class | `<Entity>Entity` |

NEVER use these suffixes:
- `Manager` — replaced by `Service`
- `Queries` — merged into `Service`
- `View` / `Pojo` / `Dto` — replaced by bare-noun DTO

## Parameter & constructor shape

> **Identity is positional; payload is an object; wiring is always an object.**

### Positional vs object

Pass **positional** parameters for:

- A single identifying primitive — almost always an `id` (or a path /
  name acting as a key): `get(id)`, `open(id)`, `findById(id)`,
  `findByPath(dir)`, `delete(id)`.
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

Every `*Service`, `*Repository`, and anything assembled in `*.compose.ts`
takes exactly one named object — `constructor(opts: <Name>Opts)` — even
for a single dependency:

```ts
constructor(opts: { db: Db }) { this.db = opts.db; }   // repository, 1 dep
constructor(opts: WorkspaceServiceOpts) { /* … */ }    // service, N deps
```

A new dependency joins as a named field without reshuffling call sites,
and tests override deps by name
(`new SessionService({ ...opts, contentSource })`). The `*Opts` type is
exported as the package's composition contract.

The composition-root factory `compose*Module` takes its single argument
as `*ModuleOptions` (`composeWorkspaceModule(opts: WorkspaceModuleOptions)`)
— the fuller-word name used uniformly across every package's `compose.ts`.

Error and value classes follow the native `Error` shape: positional
`constructor(message, options?)` or positional identifying fields
(`constructor(public readonly workspaceId: string)`).

### At the contract boundary

`*Service` public methods present the object-first shape outward:

- **writes** accept `input: <Verb><Entity>Request`, optionally led by an
  `id`: `register(input)`, `rename(id, input)`.
- **reads** key off a positional `id` and return the bare-noun DTO
  (`Workspace`) or a `*Response` envelope (`CurrentWorkspaceResponse`).

A public boundary method never takes multiple parallel primitives, a bare
boolean, or a `*Row`.

## Wire / HTTP layer conventions

> Applies to `@glyphs-ai/api`'s `wire/` surface — the wire / HTTP layer.
> The `## Naming conventions` rules above govern *pkg-internal* types
> (`*Row` / `*Entity` / bare-noun DTO). This section governs the
> *cross-the-wire* types that live under `packages/api/src/wire/`: HTTP
> request / response bodies and the per-endpoint projections of pkg
> DTOs.

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

> glyph uses an **explicit Row → Entity → DTO split**: the Entity layer
> makes the contract uniform, the row stays ORM-private, and the DTO
> stays wire-stable.

### The layers

| Layer | Lives in | Suffix | Visibility | Role |
|---|---|---|---|---|
| **Row** | `persistence/tables.ts` | `*Row` | pkg-private; repository-internal; optional | Drizzle `$inferSelect` / `$inferInsert` shape; used only inside the repository to map to/from the entity |
| **Entity** | `domain/<entity>.entity.ts` | `*Entity` | pkg-private (NOT re-exported from `index.ts`) | Pkg-owned domain shape, **hand-declared** — a `class` for rich BCs, a hand `interface` for anemic BCs. Never an alias of the row |
| **DTO** | `contract/<entity>.types.ts` | **bare noun** (no suffix) | exported from `./contract` | Wire shape; what `<Entity>Service` returns; stable contract for HTTP / CLI / other pkgs |

### The boundary rule (hard)

> **The repository is an adapter.** Its public methods speak the domain
> `<Entity>Entity` (and primitive ids) only: reads RETURN
> `<Entity>Entity`, writes ACCEPT `<Entity>Entity`. The Drizzle
> `<Entity>Row` / `New<Entity>Row` types MUST NOT appear in any public
> signature — the repository maps row ↔ entity internally.
>
> **`<Entity>Service`'s public methods return the wire `<Entity>` DTO.**

### Mapping row ↔ entity — structural for anemic, explicit for rich

The domain Entity is **hand-declared**, never aliased from the table —
even for an anemic BC where it coincides with the row today. The domain
owns its contract; persistence owns the table; the repository bridges
them:

```ts
// domain/<entity>.entity.ts — domain-owned, no import from persistence
export interface WorkspaceEntity {
  readonly id: string;
  readonly workspaceDir: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string | null;
}
```

For an **anemic BC** the row and entity coincide structurally, so the
repository maps them implicitly — no helper, and no `*Row` types needed:

```ts
async findById(id: string): Promise<WorkspaceEntity | undefined> {
  return this.db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

async insert(entity: WorkspaceEntity): Promise<void> {
  this.db.insert(workspaces).values(entity).run();
}
```

For a **rich BC** the entity is a `class`; the repository maps both
directions explicitly with private helpers — `rowToEntity` on the way
out, `entityToRowFields` on the way in.

Similarly, when Entity → DTO is a trivial spread + 1-line normalisation,
inline it at each service read call site rather than extracting a helper:

```ts
async getById(id: string): Promise<Workspace | null> {
  const entity = await this.repo.findById(id);
  return entity ? { ...entity, lastOpenedAt: entity.lastOpenedAt ?? entity.createdAt } : null;
}
```

Extract a `rowToEntity` / `entityToDto` helper when:
- Row gains columns that must NOT bleed into Entity (e.g. soft-delete
  `deletedAt`), OR
- Multiple service methods do the same non-trivial projection, OR
- The projection is async / requires cross-pkg context (e.g.
  `SessionEntity` + workdir computation + live runtime metadata →
  `Session` DTO).

### When Entity is a class (rich BC)

Implement `domain/<entity>.entity.ts` as a `class` instead of a hand
`interface` when the BC needs:
- Non-trivial state transitions (`running → succeeded`)
- Invariant validation on every mutation
- Immutable functional updates (`entity.withMetadata(...)`)

Repository still returns the Entity class instance; service projects to
DTO at the wire boundary.

## Single service per BC

Every BC exposes exactly ONE public class:

- **`<Entity>Service`** — both reads (list / get / lookup) and writes
  (create / update / delete / state transitions). Returns DTOs.

There is no separate `<Entity>Queries` class.

If a downstream package only needs a narrow subset of methods, declare
a small **capability interface** in the downstream package and depend
on that, rather than importing the whole service type:

```typescript
// packages/runtime/src/types.ts — minimal surface for "resolve an agent"
export interface AgentContentSource {
  resolveAgent(fqn: string): Promise<AgentResolveResult>;
  // ... 3 more methods, total 4
}
```

The downstream pkg accepts `AgentContentSource`; the composition root
passes a `CatalogService` instance (which structurally implements the
interface). This is a real example from `@glyphs-ai/runtime`.

## Composition root

The composition root (`@glyphs-ai/api`'s `WorkspaceContextRegistry.load`)
calls each `compose<Entity>Module({ dbFile, now? })` once per workspace
and threads the `service` into downstream pkgs (either as-is or through
a capability interface). The template compose function accepts only a
real SQLite path and optional test seams; tests that need an in-memory DB
pass `dbFile: ":memory:"`.

`src/<entity>.compose.ts` opens the database with `openDb(dbFile)`,
constructs the private repository, constructs the public service, and
returns `{ service, close }`. External callers do not pass a DB handle
or instantiate repositories directly.

## Errors

All public error classes live in `src/contract/<entity>.errors.ts`.
Convention:

```typescript
export class XxxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XxxError";
  }
}

export class XxxNotFoundError extends XxxError {
  override readonly name = "XxxNotFoundError";
  constructor(public readonly id: string) {
    super(`Xxx "${id}" not found`);
  }
}
```

Two rules:
1. Every BC has a base `<Entity>Error` class; specific errors extend it.
   Same-realm callers can `catch (e) { if (e instanceof XxxError) … }`.
2. Subclasses declare `override readonly name = "..."` with a literal
   string equal to the class name. Do NOT use `this.name = new.target.name`
   — bundlers can name-mangle the class and break it.

Route / CLI layers should branch on `error.name` (string literal), NOT on
`instanceof XxxError` — bundlers can split the class definition across
chunks and `instanceof` will silently fail across package boundaries.

Input format validation is not represented by package-specific error
classes. It lives in zod schemas under `contract/`; service methods call
`Schema.parse(...)`, and the api layer maps `ZodError` to a 400
`ValidationError` envelope.

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

`drizzle.config.ts` points `schema:` at `./src/persistence/tables.ts`.
After drizzle-kit writes a new `drizzle/NNNN_*.sql`,
`scripts/inline-migrations.mjs` regenerates
`src/persistence/migrations.ts` so the SQL is embedded into the runtime
bundle. The package's `db:generate` script runs both steps.

The generated migrations file is not hand-maintained:

```ts
// src/persistence/migrations.ts — generated by scripts/inline-migrations.mjs
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

At runtime, `persistence/<entity>.db.ts` calls the generated applier from
`openDb(dbFile)`, walking migrations in order and recording them in the
pkg's `__drizzle_migrations_<pkg>` table. SQL is embedded as strings in
the JS bundle — no filesystem reads at runtime. The same `openDb` path is
used by tests with `":memory:"`, so in-memory DBs see the production
schema.

## Splitting big files via facade + sibling subdir

### When to split

Default: keep one file per `<entity>.<role>.ts` (see naming convention above).

Split a single file ONLY when BOTH conditions hold:

1. The file is **≥ 600 LOC**.
2. The file genuinely contains **≥ 3 cohesive sub-concerns** (e.g. queries vs mutations vs lifecycle vs streaming).

A pure 800-LOC validator (one concern) does NOT split. A 400-LOC service touching 5 concerns does NOT split (too small). A 700-LOC service with reads / writes / lifecycle / streaming DOES split.

### Layout: facade + sibling subdir

```
packages/<pkg>/src/application/
  <entity>.service.ts          ← facade (public entry, ≤ ~250 LOC)
  <entity>.service/            ← subdir; basename MUST equal facade basename
    <concern-1>.ts             ← bare concern name; no entity prefix needed
    <concern-2>.ts
    …
```

Reference skeleton: `packages/_template/_examples/split-layout/`.
It demonstrates `__entity-kebab__.service.ts` next to
`__entity-kebab__.service/` using placeholder names.

### Hard rules

> **Scope.** These 7 rules apply ONLY when a subdir has a sibling `.ts` / `.tsx` file at the parent level (the SPLIT pattern — e.g. `example.service.ts` next to `example.service/`). Subdirs without a sibling file (CATEGORY dirs — e.g. `packages/catalog/src/agent/`, `packages/catalog/src/facade/`, `packages/server/src/routes/`) are a separate, pre-existing organisational pattern and are unaffected by these rules; they MAY contain an `index.ts` barrel and follow the multi-entity / per-route conventions documented elsewhere on this page.

1. **Subdir basename equals facade basename AND is a direct sibling.** `example.service.ts` ↔ `example.service/` in the same directory. Enforced mechanically — see the structural test in `packages/e2e/test/architecture/split-convention.test.ts`. The subdir MUST sit next to its facade; a subdir at any other path (e.g. `src/internal/<role>/`) is not a recognised SPLIT and forfeits the no-barrel and package-private guarantees this convention provides.
2. **No barrel re-export** inside the subdir (no `<entity>.<role>/index.ts`). The facade composes via direct relative imports (`./example.service/queries.js` etc.). Enforced by the same structural test.
3. **Subdir files are package-private.** They MUST NOT appear in the package's top-level `src/index.ts` barrel. The facade is the only public surface.
4. **Concern files use bare names** (`queries.ts`, `mutations.ts`, `shutdown.ts`) — the subdir name already supplies the entity context. Do NOT prefix (`example.queries.ts` inside `example.service/` is wrong).
5. **Each concern file ≤ ~450 LOC.** If a single concern grows beyond that, that concern itself needs further decomposition — but always keep at one level of nesting (do NOT nest `example.service/queries/by-id.ts`).
6. **Facade stays ≤ ~250 LOC** and contains only: constructor, ctx-object construction, and 1-line delegates to internals.
7. **Shared context.** The facade builds a `<Entity>ServiceCtx` (or similar) once and passes it to every internal — no `this`-casting, no widening of class field visibility. Each internal exports plain functions taking `(ctx, …args)` OR a small object that consumes ctx.

### On-disk reference example

`packages/_template/_examples/split-layout/` contains a self-contained,
fully-rule-compliant SPLIT skeleton with placeholder names — a
copyable shape for contributors making their first split. The skeleton
is **documentation that happens to be on disk**. It is NOT built, NOT
typechecked under any tsconfig, NOT run by any test — the leading
underscores on `_examples/` and `_template/` keep it out of the
structural classifier in
`packages/e2e/test/architecture/split-convention.test.ts`, and the
scaffolder (`scripts/new-pkg.mjs`) skips this dir when copying so new
packages do not inherit it.

**Each hard rule mapped to its concrete artifact in the example:**

| Rule | Demonstrated by |
|------|-----------------|
| **#1** Subdir basename equals facade basename AND is a direct sibling | `__entity-kebab__.service.ts` next to `__entity-kebab__.service/` in the same directory |
| **#2** No barrel inside the subdir | The subdir contains `types.ts`, `queries.ts`, `mutations.ts`, `lifecycle.ts`, `_helpers.ts` — no `index.ts` |
| **#3** Subdir files are package-private | The facade is the only thing a downstream `index.ts` would re-export; concern files are never named in the public barrel |
| **#4** Concern files use bare names | `queries.ts`, `mutations.ts`, `lifecycle.ts` — no `__entity-kebab__.queries.ts` prefix |
| **#5** Each concern file ≤ ~450 LOC; no nesting | The skeleton concerns stay tiny; there is no `queries/by-id.ts` subdir |
| **#6** Facade ≤ ~250 LOC, only ctx construction + 1-line delegates | `__entity-kebab__.service.ts` does exactly that and stays under 100 LOC |
| **#7** Shared context | Facade builds `__Entity__ServiceCtx` once (defined in `__entity-kebab__.service/types.ts`) and passes it to every concern function. No `this`-casting, no field-visibility widening |

The `_helpers.ts` file inside the subdir demonstrates the
package-private utility seam: extract a helper there when **the same
logic appears in two or more concern files** (e.g. an ISO-timestamp
parser used by both `queries.ts` and `mutations.ts`). The leading `_`
on the filename is the same "package-private utility" signal as the
top-level `_shared.ts` files cited under "When NOT to use this
pattern" below. If a helper is used inside only one concern, keep it
private to that concern instead.

### Applying the convention

When your real `<entity>.service.ts` outgrows the 600 LOC / 3-concern
thresholds:

1. **Copy the structure, not the content** from
   `packages/_template/_examples/split-layout/` into your package's
   `src/application/` (the facade file + the matching subdir + the
   concern peer files). Do not copy the placeholder file bodies — write
   your own logic.
2. **Rename the placeholders.** Search-and-replace
   `__entity-kebab__` → your kebab-case entity name (e.g. `task`), and
   `__Entity__` → your `PascalCase` entity name (e.g. `Task`). The
   scaffolder's token substitution recipe is documented in
   `scripts/new-pkg.mjs`.
3. **Move methods into the appropriate concern peer file.** One concern
   at a time: cut the read methods into `queries.ts`, the write methods
   into `mutations.ts`, the lifecycle hooks into `lifecycle.ts`. Each
   function takes `(ctx, …args)` as its first parameter. The facade keeps
   only constructor + ctx-build + 1-line delegates.
4. **Register the new SPLIT** — see § Migration of existing big files
   below for the exact `REQUIRED_SPLITS` /
   `EXPECTED_CATEGORY_DIRS_AT_CONVENTION_INTRODUCTION` updates.

### When NOT to use this pattern

- **Cross-entity shared infrastructure** → use a `_shared.ts` file (or a `_*` subdir) — the structural test skips any directory whose name starts with `_`, and treats `_`-prefixed files as ordinary peer modules outside any SPLIT registry. The leading underscore signals "package-private utility, not a facade-split peer".
- **Component organisation** (e.g. a page + its sub-components) → `packages/dashboard/src/components/tasks/TaskDetail.tsx` + `TaskDetail/` already does this; it is a related but distinct pattern (the subdir contains presentational sub-components, not concern splits of one class). The same structural rules (no `index.tsx` barrel, exact-case sibling) apply.
- **Different concerns belonging to different services** in the same package → keep them as separate top-level `<entity>.<role>.ts` files in the appropriate layer.

### Migration of existing big files

Pre-existing big files do NOT need preemptive splitting. Apply this convention WHEN a refactor of that file is otherwise needed (e.g. a feature change, a bug fix that touches many sections, an audit-flagged improvement). PRs that opportunistically split should reference this section in the PR body.

**Registry maintenance (mandatory).** When you split a previously-flat file under this convention, also update `packages/e2e/test/architecture/split-convention.test.ts`:

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
// src/application/paths.ts or src/persistence/paths.ts, depending on the owner
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

### Multi-entity BCs → one set of four layers, entities namespaced by file prefix

A BC that owns more than one rich entity participating in cross-entity
orchestration (catalog owns Agent + Skill + Mcp) keeps the SAME top-level
four layers as a single-entity package. Entities are namespaced inside
each layer by the `<entity>.` file prefix — there is no per-entity subtree
(`agent/domain/…`). The dot prefix (see § File naming convention) already
makes every file's class location unique.

```
src/
  index.ts                       public barrel (facade service + compose + result types)
  catalog.compose.ts             composeCatalogModule({ ... })

  contract/
    catalog.types.ts             cross-entity DTOs (bare nouns: Agent / Skill / Mcp)
    catalog.errors.ts            cross-entity error base + facade errors
    catalog.schemas.ts           cross-entity / install-body validators
    agent.errors.ts              per-entity errors (skill / mcp mirror)
    agent.schemas.ts             per-entity validators (skill / mcp mirror)
    index.ts

  domain/
    agent.entity.ts              AgentEntity (internal; skill / mcp mirror)
    agent.frontmatter.ts         entity-specific codec (mcp.format.ts, …)
    catalog.dep-keys.ts          cross-entity domain helpers (origin grammar, …)

  application/
    agent.service.ts             per-entity write logic (internal; skill / mcp mirror)
    catalog.service.ts           unified read+write facade across all entities
    catalog.service/             facade split subdir (only past the split threshold)
    catalog.projection.ts        cross-entity orchestration helpers (plan-types, pipeline, …)

  persistence/
    tables.ts  migrations.ts  catalog.db.ts
    agent.repository.ts          per-entity repository (skill / mcp mirror)
```

Naming follows one rule: cross-entity files take the bare-noun `catalog.`
aggregate prefix (`catalog.service`, `catalog.projection`, `catalog.origin`);
per-entity files take the `agent.` / `skill.` / `mcp.` prefix.

The per-entity `<entity>.service.ts` classes are **internal** to the BC;
they are not exported from the package barrel. External callers reach the
BC through the facade (`index.ts`) and the DTOs / errors / schemas
(`./contract`) only.

An outbound infrastructure adapter that belongs to none of the four layers
(catalog's content `fetcher/` — origin URI → bytes) stays in its own
top-level dir, a peer of `persistence/`.

### Test seams (clock, randomness)

Service constructors accept an optional `{ now?: () => Date; randomBytes?: (n: number) => Buffer }`
opts object when the service touches the clock or generates ids. Pass
fakes from tests; production callers omit the opts to get the real ones.
The template's `__Entity__Service` shows the minimal `now?` pattern.

