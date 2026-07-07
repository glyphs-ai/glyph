# Architecture

This document is for **contributors** — people writing code in this repo
or adding a new runtime adapter. End-user docs live in the root
[`README.md`](../README.md). The conceptual rationale — *why* glyph is
shaped the way it is — lives in the paper
[*What we believe about agentic systems*](./paradigm.md).

Alongside the TypeScript packages, the repo ships a
[`first-party/`](../first-party/) subtree of bundled agents and skills
under `scope: official`. These entries depend on internals defined here
(catalog schema, CLI surface, runtime contracts) tightly enough that
they version-bump and PR in lock-step with the packages.

## Tier model

glyph's packages organise around a 5-tier model. Each tier number
describes *what kind of thing* a package is — not who imports whom.
Dependency-direction invariants (port vs direct import, allowed
imports per tier) are a **separate axis** with its own rules, **TBD
in a follow-up doc**.

| Tier      | Name        | Packages                                            | Conceptual role                                                                         |
| --------- | ----------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **T0**    | Foundations | `catalog`, `runtime`, `schedule`, `terminal`, `workspace` | Who / Where / When / Scope + leaf infrastructure — irreducible primitives                |
| **T1**    | Modes       | `session`, `task`, `workflow`            | How work runs — Interactive (`session`) / Headless single-shot (`task`) / Multi-task DAG (`workflow`) |
| **T2**    | Application | `api` (orchestration + HTTP route factories), `sdk` (generated client) | Two siblings — `api` composes T0/T1 into business capabilities, assembling domain-owned zod schemas into OpenAPIHono route factories; `sdk` is the typed client generated from the resulting OpenAPI spec |
| **T3**    | Host        | `server`                                            | HTTP transport that exposes T2 capabilities over the wire                               |
| **T_top** | Surfaces    | `dashboard`, `cli`                                  | Platform-specific UI on top of T3                                                       |

`workflow` is a T1 execution mode alongside `session` and `task`: it owns
its own SQLite substrate (`workflows`, `workflow_nodes`, `workflow_edges`),
exposes a `WorkflowService` via `composeWorkflowModule`, and has zero
workspace deps just like the other T1 packages. Wiring into `api` and
exposure via `server` routes follow the same pattern as `session` and
`task` — the workflow-specific task runners live in
`packages/api/src/wiring/` and the HTTP routes live in
`packages/server/src/routes/workflows.ts`.

`task` is Result-native (neverthrow `Result` on every boundary,
discriminated-union errors, a four-layer domain / application /
infrastructure split with per-use-case
`UseCase<Request, Response, Error>` classes) and dispatched through the
`TaskModule` DI container built by `composeTaskModule`.

### Tier philosophy

**Pure conceptual classification.** A tier number describes *what
kind of thing* a package is, not who imports whom. Two packages can
sit in the same tier even if one imports the other. Whether a
dependency flows via direct import, via a declared port, or via a
wire format is a separate axis (see "Dependency invariants" — TBD).

**Each tier answers a different question.**

- T0 — what irreducible primitives does an agentic system need?
  (Who runs · Where to run · When to run · within what Scope)
- T1 — in what *mode* is the work running? Three execution modes:
  - `session` — Interactive (long-lived shell + user turns)
  - `task` — Headless single-shot (one brief, one terminal verdict)
  - `workflow` — Multi-task DAG (`session` / `task` nodes connected by
    edges, coordinated by `coordinator` task nodes that mutate the DAG
    based on parent terminal state)
- T2 — what can the system *do*, and how is that spelled? Split
  across two siblings:
  - `api` — the *how it's built* AND the *what is on the wire*:
    `composeApplication`, `WorkspaceContext`, per-workspace registries,
    schedule-task wiring (Node-only orchestration that assembles T0/T1
    services), plus the HTTP surface — the per-domain `OpenAPIHono`
    route factories under `src/routes/` that compose the request /
    response zod schemas the domain packages own, and the shared
    Problem-envelope error surface (`src/schemas/problem.ts`). The api
    barrel re-exports the route factories + error surface so the
    in-process server composition root gets both layers from one import
    site. Consumed by `server`.
  - `sdk` — the *typed client for the wire*: a fully-generated fetch
    client (`@hey-api/openapi-ts`) over `server`'s `/api/openapi.json`,
    whose generated barrel (`src/generated/`) exports one tree-shakeable
    operation per route (`getApiHealth`, …) plus every request / response
    type, wrapped by the only hand-written code we own — the `unwrap` /
    `unwrapOr` result helpers and the normalised `GlyphError` type.
    Self-contained at runtime (zero `@glyphs-ai/*` imports — the
    generated output inlines its own fetch client), so it ships safely to
    browser surfaces. Codegen is devtime-only tooling under `scripts/`
    that reads `server` source to assemble the spec; that devtime edge is
    not a runtime tier dependency (enforced by
    `sdk-no-server-runtime-import.test.ts`). The strict-isolation surface
    for `dashboard` and `cli`.
- T3 — how do remote clients invoke T2? `server` is a thin HTTP
  binding.
- T_top — how does a human (or another agent) interact?

**Visibility rule.** The fence is **partial and partly
machine-enforced**:

- **Strictly enforced** (lint test
  `packages/e2e/test/architecture/tier-invisibility.test.ts`):
  `@glyphs-ai/dashboard` source + tests may only reference
  `@glyphs-ai/sdk`; `@glyphs-ai/cli` may only reference
  `@glyphs-ai/sdk` and `@glyphs-ai/server`. Pkg-manifest deps are
  audited alongside source imports — a dangling devDep that hoists
  an orchestration pkg into the consumer's `node_modules` is
  flagged even when no source file imports it.
- **Convention only** (not machine-enforced): T0/T1 packages SHOULD
  NOT be imported by T3 or T_top (server or other surfaces).
  `server` may import T0/T1 directly today; the dashboard / cli
  fence above is the strict half. `@glyphs-ai/api` exposes the HTTP
  route factories (its `src/routes/` surface) for server's convenience.

The fenced consumers' allowed edges:

```text
                       ┌──────────────────────────────┐
@glyphs-ai/dashboard ──▶ │ @glyphs-ai/sdk (T2)            │
@glyphs-ai/cli       ──▶ │   generated client + wire types │
                       └──────────────────────────────┘
@glyphs-ai/cli       ──▶ @glyphs-ai/server  (the cli binary IS the
                                         server bundle; `glyph
                                         serve` boots in-process,
                                         `glyph start` spawns it)
```

**`api` is the orchestration composition root.** New cross-cutting
features land in `api` (HTTP shapes become `createRoute` entries in its `src/routes/` factories, composed from domain-owned zod schemas);
transport (`server`) and UI (`dashboard` / `cli`)
stay thin. The leaf infrastructure pkgs (`terminal` and the runtime
adapters) carry no orchestration of their own — `api` is the only
in-process consumer that wires them together.

## Layering

The repo is one [pnpm workspace](https://pnpm.io/workspaces) of
packages with a strict layering. Higher layers may depend on lower
layers; never the reverse. The 5-tier model (see [§ Tier model](#tier-model))
gives each box a name.

```text
                ┌────────────────────────┐
                │ @glyphs-ai/dashboard     │  React + Vite SPA (T_top)
                └───────────┬────────────┘
                            │ HTTP /api/*      ┌────────────────┐
                            │           ┌─────▶│ @glyphs-ai/      │
                            │           │      │   sdk          │
                ┌───────────▼────────────┤      │  (T2 — gen     │
                │ @glyphs-ai/cli           │      │   client +     │
                │ (lifecycle commands)   │      │   wire types)  │
                └───────────┬────────────┘      └───────▲────────┘
                            │ HTTP /api/*               │
                ┌───────────▼────────────┐              │  generated
                │ @glyphs-ai/server        │──────────────┘  from spec
                │ (routes + middleware)  │  T3 Host        (devtime)
                └───────────▲────────────┘
                            │  composes T0/T1           │
                ┌───────────┴────────────┐    ┌─────────┴──────┐
                │ @glyphs-ai/api           │───▶│ @glyphs-ai/      │
                │ T2 Application:        │    │  terminal      │
                │  composeApplication    │    │ (spawn         │
                │  + WorkspaceContext    │    │  launcher)     │
                │  registry              │    └────────────────┘
                └───────────▲────────────┘
                            │
   ┌─────┬───────┬──────────┬─────────────┬────────────────┐
   │     │       │          │             │                │
┌──┴──┐ ┌┴────┐ ┌┴────────┐ ┌┴─────────┐ ┌┴───────────┐ ┌──┴─────────┐
│task │ │sess │ │workflow │ │ catalog  │ │ workspace  │ │  runtime   │
└──▲──┘ └──▲──┘ └─────────┘ └──────────┘ └────────────┘ └────────────┘
   T1     T1       T1            T0            T0             T0
   │      │
   └──────┴── runtime adapters consumed by task + session
```

`@glyphs-ai/sdk` is the strict-isolation surface for the fenced
consumers: a generated, browser-safe HTTP client plus the wire types
it exchanges, zero orchestration code. The wire contract itself is
assembled in `@glyphs-ai/api`'s `OpenAPIHono` route factories (under
`src/routes/`) from the request / response zod schemas the domain
packages own; the api barrel re-exports those factories, so the
in-process server boot path can import "both halves" from a single
specifier (`@glyphs-ai/api`). Dashboard and CLI MUST go through
`@glyphs-ai/sdk` directly — the structural fence is enforced by
`packages/e2e/test/architecture/tier-invisibility.test.ts`.

`@glyphs-ai/terminal` is consumed **only by `@glyphs-ai/api`** at
runtime — specifically by `composeApplication`, which value-imports
`spawnTerminal`, wraps it as a `SpawnPort`, and threads it through
`composeSessionModule`. The actual "build the `LaunchCommand` and hand
it to the spawner" step lives inside the session package's
`spawnInteractive` use-case. `api`'s job is wiring, not invocation.
Entity packages don't see `@glyphs-ai/terminal` — `@glyphs-ai/session`
consumes the spawner via the structurally-typed `SpawnPort` port
(`spawn(launch) => ResultAsync<{ launcher }, SpawnFailed>`) without
importing terminal at all, so the cross-domain architecture fence
(`packages/e2e/test/architecture/inter-service-imports.test.ts`)
stays intact. `@glyphs-ai/runtime` produces `LaunchCommand` values
but does not spawn terminals. The dep direction is asymmetric and
deliberate: `terminal` declares its own `LaunchCommand` shape as a
**consumer port** (see `packages/terminal/src/types.ts`) and has
zero workspace deps; `runtime`'s `LaunchCommand` is the
producer-side definition; TypeScript's structural typing wires the
two together at the `composeApplication` call site without forcing
either pkg to depend on the other.

The entity packages (`workspace`, `session`, `task`, `workflow`,
`schedule`, `catalog`) sit at the same level — they don't depend on each
other directly. Composition happens at the
[`@glyphs-ai/api`](../packages/api) layer: api holds one
`WorkspaceService` process-wide and lazily mints per-workspace
`{catalog, sessions, tasks, schedules, workflows}` bundles behind a
`WorkspaceContextRegistry`. The server depends on api, not on the
entity pkgs directly. `runtime` is consumed by `session` + `task` to
spawn agents; `workflow` does not spawn anything itself — its DAG
nodes are `task` / `session` nodes that the workflow runner dispatches
through the same T1 execution-mode pipeline.

## Module + repository pattern

Every entity package follows the same shape: a **3-layer Row / Entity /
DTO** split. A package exposes a compose function that returns its module
surface; the module owns the use-cases that orchestrate reads + writes
against package-private Drizzle repositories. `task` exposes
`TaskModule`, a DI container of per-use-case
`UseCase<Request, Response, Error>` classes returning `ResultAsync` with
discriminated-union errors. Repositories return package-owned entities at
their boundary. The full contract (layer table, projection-helper rules,
when Entity becomes a class) and the rationale for this specific shape
live in
[`docs/pkg-template.md` → Repository contract](./pkg-template.md#repository-contract).

In-tree examples: anemic BCs (`workspace`, `session`) use a plain
`interface` for Entity; rich BCs (`catalog`, `task`) use a class with
FSM transitions and invariant validation. Tests open the module
against `dbFile: ":memory:"` via the package's `compose<Entity>Module`
helper, so the schema goes through the real drizzle-kit migrator on
every test boot.

## Atomic IO seam

Out-of-band JSON files (the CLI lifecycle `runtime.json`, agent-baked
`AGENTS.md` / `.mcp.json`) are written via
[`write-file-atomic`](https://github.com/npm/write-file-atomic) —
write-temp + rename, so readers see old or new bytes, never partial.
Use it for any long-lived JSON / Markdown file consumed by an
external reader. `proper-lockfile` covers the cases that need a
PID-aware advisory lock (the runtime adapter's per-session state
preflight).

Long-lived structured state lives in SQLite (`global.db`,
`workspace.db`) and gets the equivalent guarantees from WAL mode +
transactions — no separate atomic-write layer needed there.

## Backend selection: when SQLite

glyph deliberately keeps its persistence backend simple and consistent.
Today **every entity is SQLite-backed**, but the DBs are split by
**scope** (where the data lives in the lifetime hierarchy), not by
entity:

- **`<GLYPH_HOME>/global.db`** — workspace registry + cross-workspace
  state (current-workspace pointer, future audit logs, etc).
- **`<workspace>/workspace.db`** — every per-workspace entity (catalog,
  session, task, workflow). One connection serves them all,
  shared via DI from `WorkspaceRuntime` (in `@glyphs-ai/api`).

Each pkg owns its own tables inside the shared DB. Schema evolution
goes through **drizzle-kit** — `pnpm --filter @glyphs-ai/<pkg>
db:generate` produces an SQL file under `<pkg>/drizzle/`; the
in-pkg migrator at compose time applies them and records the
applied filename in `__drizzle_migrations`. There is no
cross-package coordinator any more — each pkg's table set is
managed by its own drizzle-kit setup. The service holds no
in-memory snapshot; SQLite is the source of truth and reads run in
autocommit so external writes are observable on the next request.

Why one DB per scope rather than one DB per entity:
- Cross-entity JOINs and atomic multi-table transactions are cheap
  (no `ATTACH DATABASE` dance).
- File handle count per workspace is exactly one.
- Backup / migration / diagnostic story is a single file.
- Mirrors industry norm for desktop SQLite apps (Copilot CLI,
  Obsidian, Logseq) where data sharing across "modules" within a
  single workspace is the default.

### When NOT SQLite (intentionally on the filesystem)

- **Agent workdirs** — `<workspace>/sessions/<id>/`,
  `<workspace>/tasks/<id>/` are the agent's own product dirs. glyph
  creates them and bakes a starter `AGENTS.md` / `.mcp.json` from the
  catalog; the agent owns everything else inside.
- **Server lifecycle** — `<GLYPH_HOME>/runtime.json` (pid + port)
  stays a JSON file for ops ergonomics. Port-binding is the
  actual mutex; SQLite's atomic-write would buy nothing here.
- **Logs** — `<GLYPH_HOME>/logs/` is rotated JSONL via `pino-roll`.

### Hybrid: when an entity has both metadata and content

`session` and `task` use a **hybrid** pattern: SQLite owns the
queryable metadata; FS owns the human-meaningful content. The
metadata row lives in the per-workspace `workspace.db`; the workdir
directory tree (`<workspace>/sessions/<sid>/...` for session,
`.../tasks/<tid>/` for task) stays a plain directory of agent-produced
files (AGENTS.md, artifacts, captured stderr). The default `delete(id)`
removes only the metadata row (the "archive" mode — matches the
workspace-wide "purge is opt-in" pattern, giving operators a chance
to inspect agent output after a delete); `delete(id, { purge: true })`
additionally removes the workdir AND asks the runtime to wipe its
own per-entity state (Copilot's `<copilotStateDir>/<id>/` etc.) via
`Runtime.deleteState(runtimeSessionId)` — the same verb is used for
both sessions and tasks because the runtime is domain-agnostic, so
a hard delete leaves nothing behind across the layers.

This split keeps the workdir-as-product invariant (`cd` into a session
workdir, find the agent's actual output, grep it, commit it to your
own git history) while moving the metadata into a shape that scales
to thousands of rows under filtering / sorting queries.

### Why no unified persistence service

An earlier exploration considered a generic `PersistenceService`
(`@glyphs-ai/storage`). It was deliberately not built. Each entity's
repository surface is shaped by its own queries:
`WorkspaceService.getLastOpened()`,
`TaskModule.listTasks.execute({ statuses, runtime, ... })`,
`CatalogService.resolveAgent()` (graph). A unified interface would
force these into either an `unknown`-typed lowest common denominator
or a parade of entity-specific extension methods that re-introduce
the per-entity shape it was meant to remove.

The pattern that works: **shared SQLite connection per scope (global
+ per-workspace), per-entity drizzle-managed tables.**

## Unified verb conventions

- **Delete with optional purge** — service-style packages use
  `delete(id, { purge?: boolean })`; `task` uses
  `deleteTask.execute({ id, purge })`. Default is metadata-only (the
  repository row is removed; agent-produced files under
  `<workdir>/<entity>/<id>/` are preserved for archival). `purge: true`
  additionally removes the entity's sandbox directory. The workspace's
  `workdir` itself is **never** removed by glyph; it's user-owned. REST
  mirrors: `DELETE /api/workspaces/:id/tasks/:tid?purge=1`.
- **Stripe-style hybrid params** — primary key (id) positional;
  flags / options in a single trailing options bag
  (`service.rename(id, { newName })`). `register`-style creates
  that have no canonical positional key take a single options bag
  (`service.register({ id, workspaceDir, name })`). The shape
  matches Stripe's published API style; see
  [`docs/pkg-template.md`](./pkg-template.md) for the rationale.

When in doubt, copy the pattern from `WorkspaceService`.

## Wire formats

Persisted state lives in SQLite — the schema is the wire format. Add
a column or backfill via `pnpm --filter @glyphs-ai/<pkg> db:generate`
+ the generated migration; drizzle-kit produces forward-only SQL
that the in-pkg migrator applies once at compose time.

Out-of-band JSON files (the CLI's `runtime.json`, the agent-baked
`AGENTS.md` / `.mcp.json`) are written `{schema: N, ...fields}` at
the top level. Bump `schema` on breaking changes; reject mismatches
at read time with a typed `*CorruptedError` so the dashboard can
surface the cause without crashing.

## HTTP API URL scheme

Workspace-scoped resources live under
`/api/workspaces/<wsid>/{catalog,sessions,tasks,schedules,workflows}/...`. The `<wsid>` is
the workspace's opaque UUID — stable for the lifetime of the registry
entry, so dashboard URLs survive workspace renames. There is no global
catalog mount; switching workspace switches the catalog the dashboard
sees.

A `WorkspaceContextRegistry` (in `@glyphs-ai/api`) lazily mints + retains
per-workspace `{catalog, sessions, tasks, schedules, workflows}` bundles behind that URL
prefix; cache invalidation happens on workspace deletion or rename.
An explicit `POST /api/workspaces/:id/reload` is also available for
operator-driven reload (refused with HTTP 409 +
`code=WorkspaceHasLiveTasksError` when the workspace still has live
task subprocesses).

The server is **loopback-only**: it refuses to bind to anything other
than `127.0.0.1` / `::1`. glyph ships no built-in auth, on the
principle that "rolling our own" is rarely the right answer for a
single-user local-first dashboard. For remote access, expose the
loopback socket through a layer designed for auth (SSH port-forward,
reverse proxy with mTLS / OIDC, mesh VPN with peer auth such as
Tailscale). A misconfigured non-loopback bind fails fast at startup.

## Per-workspace layout

```text
<workspace>/
├── workspace.db                 single SQLite per workspace — holds task / session / catalog tables (one row per pkg in schema_meta)
├── sessions/<id>/               agent-baked workdir; `copilot` runs here
│   ├── AGENTS.md                materialised from catalog at create time
│   ├── .mcp.json                merged from agent's MCP deps
│   └── .github/{skills,hooks}/  materialised from catalog
└── tasks/<id>/                  one-shot autonomous dispatch — workdir for agent artifacts
    ├── AGENTS.md                materialised from catalog at create time (runtime.provision)
    ├── .mcp.json                merged from agent's MCP deps (runtime.provision)
    ├── TASK.md                  user-supplied brief + optional details (created during `dispatchTask.execute(...)` via the task sandbox)
    ├── temp/                    agent scratch (created empty; not surfaced to the user)
    ├── artifact/                user-visible task output (created empty; agent-managed)
    ├── stderr.log               CLI errors (the runtime owns its event log via readActivity, NOT mirrored here)
    └── ...                      whatever the agent writes
```

The `TASK.md` + `temp/` + `artifact/` triple is the Task layer's
**file contract** with the agent. The agent receives a
short fixed framing prompt via the spawn argv that points it at this
layout; the user-supplied `brief` (+ optional `details`) is **not**
passed via argv — they live byte-for-byte in `TASK.md` (rendered as
`# <brief>\n\n<details>\n`, or just `# <brief>\n` when details is
absent). This eliminates a class of silent-degradation bugs on
Windows where any LF in user-supplied prompt bytes truncated
`cmd.exe`'s parsing of the spawn argv, silently dropping
`--output-format json` / `--resume` / etc. The framing constants
live in `packages/task/src/application/dispatch-task.ts` and are
selected per runtime kind; today only `copilot` is registered.

`temp/` and `artifact/` are agent-managed after creation; glyph
does not prune them. `artifact/` is the user-visible task output
directory; hosts expose its files through task artifact endpoints.

Workspace metadata (`name`, `createdAt`, `defaults`) lives in
`<GLYPH_HOME>/global.db` keyed by workspace id — there is no
`workspace.json` sidecar. Catalog content (agents/skills/mcps) lives in
the workspace's `workspace.db`, not as loose files; the dashboard /
CLI mutates them via the catalog API.

The conventional sub-paths under `workdir` (`sessions/`, `tasks/`) are
computed by `workspaceLayout(workdir)`, not stored on the `Workspace`
entity.

## How runtimes plug in

A runtime adapts a third-party CLI for glyph. The contract is
**domain-agnostic**: it knows nothing about glyph's `Session` or
`Task` value types — managers (`@glyphs-ai/session`, `@glyphs-ai/task`)
translate their domain into runtime calls at the call site, keyed
by an opaque `runtimeSessionId` string. The contract lives at
[`packages/runtime/src/types.ts`](../packages/runtime/src/types.ts):

```ts
interface Runtime {
  readonly kind: string;                                              // "copilot", "gemini", ...
  readonly capabilities?: RuntimeCapabilities;                        // optional capability flags surfaced via /api/runtimes

  // Interactive (-i)
  provision(workdir, agent, catalog, ctx): Promise<{                  // bake agent into workdir
    runtimeSessionId: string | null;                                  //   pre-allocate? null = discovery-only
  }>;
  buildInteractiveLaunch(runtimeSessionId, workdir, workspaceDir, opts?): // produce the exact `cmd args cwd`,
    Promise<LaunchCommand>;                                           //   running per-launch preconditions
                                                                       //   keyed off workspaceDir

  // Non-interactive (-p)
  launchHeadless?(opts): Promise<RuntimeHandle>;                      // optional: spawn one-shot worker

  // Observability (uniform across modes; keyed by runtimeSessionId)
  readMetadata?(runtimeSessionId):                                    // optional: title / lastActiveAt
    Promise<RuntimeSessionMetadata | null>;
  readActivity?(opts):                                                // optional: parsed timeline,
    Promise<ActivityResult | null>;                                   //   tail-first; before/after/limit
  getLastAgentActivity?(runtimeSessionId):                            // optional: most recent agent-produced
    Promise<AgentActivity | null>;                                    //   utterance (excludes tool / system events)
  streamActivity?(opts): AsyncIterable<ActivityItem>;                 // optional: live SSE tail

  // Maintenance
  deleteState(runtimeSessionId): Promise<void>;                       // remove CLI's recorded state
}
```

> If this snippet drifts, treat
> [`packages/runtime/src/types.ts`](../packages/runtime/src/types.ts) as
> authoritative.

Per-runtime preconditions (e.g. Copilot's interactive mode requires
`workspaceDir` to be in `~/.copilot/config.json` `trustedFolders` to
suppress its folder-trust prompt) are owned inside the adapter and run
lazily inside `buildInteractiveLaunch`. There is no cross-runtime
"register workspace" hook — different CLIs have wildly different gating
rules and trying to abstract them just leaks one runtime's internals
into the others.

The runtime pulls **content** from the catalog through three streams,
not via on-disk paths:

```ts
catalog.agentEntries(name): AsyncIterable<{relPath, content: Buffer}>
catalog.skillEntries(name): AsyncIterable<{relPath, content: Buffer}>
catalog.getMcpContent(name): Promise<string>
```

`relPath` is always POSIX (`/`) regardless of host OS so consumers can
safely string-prefix. This shape lets a future SQLite-backed catalog
replace the FS repo without changing a line of runtime code — rows
have no on-disk path to give back, but they have content streams just
fine.

## Runtime env contract — vars exposed to spawned subprocesses

glyph spawns the third-party CLI (Copilot today, Gemini / Claude
tomorrow) as a child process for every task / interactive session
launch. The child inherits the server's `process.env` plus a fixed
set of `GLYPH_*` variables that glyph contributes itself. This is
the **public contract** for what an agent / skill / sub-shell can
rely on; everything else in the env is "best effort, host-dependent".

| Variable | Type | When set | Meaning |
| -------- | ---- | -------- | ------- |
| `GLYPH_SERVER`        | URL string | always | `http://<host>:<port>` the server is listening on. `0.0.0.0` / `::` are rewritten to `127.0.0.1` so the child can dial loopback. glyph binds loopback-only (no auth layer); see "Deliberately not exposed". |
| `GLYPH_SHARED_DIR`    | abs path   | always | `<GLYPH_HOME>/shared` — the canonical machine-shared writable directory. Same path the runtime exposes to MCP specs as `${sharedDir}`. Pick this for state shared across workspaces (a single playwright login, a model cache). |
| `GLYPH_WORKSPACE`     | UUID       | always (per run) | Workspace id (routing key for the HTTP API; `glyph ... --workspace-id <id>` accepts it). |
| `GLYPH_WORKSPACE_DIR` | abs path   | always (per run) | Workspace root on disk. Same path the runtime exposes to MCP specs as `${workspaceDir}`. Pick this for state private to one workspace. |
| `GLYPH_WORK_KIND`     | `task` \| `session` | always (per run) | Discriminator for the run that's about to start. |
| `GLYPH_WORK_ID`       | string     | always (per run) | This run's id (e.g. `20260514-abc12345`). Same value the dashboard / CLI uses as the URL key. |
| `GLYPH_WORK_DIR`      | abs path   | always (per run) | This run's workdir on disk (`<workspace>/tasks/<id>/` for tasks, `<workspace>/sessions/<id>/` for sessions). Same value as the spawned process's `cwd`. |

### Deliberately not exposed

- **`GLYPH_HOME`** in the **task / headless** path: agents that
  run inside `glyph task dispatch` see
  `process.env.GLYPH_HOME === undefined` even though the server
  itself uses it to find `global.db` / `runtime.json` / `logs/`.
  Server bootstrap passes `SUBPROCESS_ENV_SCRUB_KEYS = ["GLYPH_HOME"]`
  to `CopilotRuntime`; the runtime's `launchHeadless` translates the
  list into `undefined` overrides that `mergeEnv` (in
  `launch-headless.ts`) interprets as "delete this key from the
  inherited parent env." Rationale: AI-agent tasks should never touch
  the service-internal directory tree; the only piece they
  legitimately need is `GLYPH_SHARED_DIR` and that's exposed
  separately.
- **`GLYPH_HOME`** in **interactive session launches**: the user is
  driving a terminal they own, the shell already has `GLYPH_HOME`
  set if they care, and the launch command path doesn't override it.
  Scrub keys are NOT honoured on this path — interactive shells
  inherit the parent env wholesale and `cmd /k` / pwsh `$env:`
  prefixes can only SET values, not unset them. Treat
  `GLYPH_HOME` as ambient host state, not a session contract.
- **Other shell state**: `cwd`, `PATH`, terminal env, and so on are
  inherited from the server process verbatim. Agents and skills
  that need any of these should declare them in their own
  documentation; glyph only guarantees the table above.
- **Auth credentials**: there is no `GLYPH_API_KEY` (or analogue).
  glyph ships no auth layer — the server refuses to bind anywhere
  but loopback (`assertBindIsSafe` rejects non-loopback hosts at
  startup). Remote access is delegated to a system-level layer
  designed for it (SSH port-forward, reverse proxy with mTLS / OIDC,
  mesh VPN with peer auth). Children reach the server purely by
  dialing `GLYPH_SERVER` from the same host; no token threading
  through subprocess env, no SSE auth gap.

### Why these specific variables

The contract exists to solve the **fresh-shell problem** that
surfaces when AI-agent harnesses (Copilot CLI, Claude, …) run each
tool call in a brand-new shell. Per-shell `export
GLYPH_WORKSPACE=...` doesn't survive between calls; the agent
either has to re-export every call (forgettable, error-prone) or
pass `--workspace-id <id>` on every command (verbose, easy to typo
across two workspaces). Plumbing the identity through the very
binary the agent shells out to (`glyph task dispatch`) means
subsequent `glyph ...` calls inside the resulting subprocess
inherit the identity automatically — no setup step, no chance of
cross-workspace bleed because the agent rebuilt its env mid-
conversation.

### What downstream code should do with it

Skills and agents that need a workspace-private path should read
`GLYPH_WORKSPACE_DIR`, never derive it from `cwd` (which is
`GLYPH_WORK_DIR`, two levels under `GLYPH_WORKSPACE_DIR`).
Skills and agents that need a machine-shared path should read
`GLYPH_SHARED_DIR`. The variables are stable across glyph's
internal layout changes — even if the on-disk shape moves, the env
names stay.

## Filesystem contract

Everything glyph writes under `<GLYPH_HOME>` (default `~/.glyph`)
and a workspace's `<workdir>/` is **server-internal state**. The layout
described in [`Per-workspace layout`](#per-workspace-layout) above plus
the per-home paths below (file names, JSON shapes, SQLite schemas,
sidecar files) is implementation detail; clients — dashboard, CLI,
future MCP server — interact strictly through the HTTP API and never
read those paths directly. Reading by hand for inspection is fine;
**writes / hand-edits / `rm` by anything other than glyph are
unsupported and may be detected as corruption.**

### Per-home paths

Beyond the per-workspace tree, `<GLYPH_HOME>` holds:

| Path | Owner | Notes |
| ---- | ----- | ----- |
| `global.db`        | server               | SQLite — workspace registry (id → workdir + currentId) plus other cross-workspace state. |
| `runtime.json`     | CLI lifecycle        | Written by `glyph start`; pid + port of the running server. |
| `logs/`            | server               | Rotated server logs (pino-roll). |
| `shared/`          | runtime adapters     | `${sharedDir}` placeholder root for MCP specs. |

### Ownership boundaries

The per-workspace layout has three distinct owners — each with a
different "what hand-editing does" story:

- **glyph** owns the SQLite databases (`<GLYPH_HOME>/global.db` for
  the workspace registry + cross-workspace state, `<workspace>/workspace.db`
  for everything per-workspace including catalog content) plus their
  `-wal` / `-shm` sidecars. Add or remove catalog entries through
  `glyph catalog ...` or the dashboard so the SQLite index stays
  consistent with the install/sync workflow; do not edit by hand.
- **the agent** owns the contents of `<workspace>/sessions/<id>/` and
  `<workspace>/tasks/<id>/` after glyph creates the directory and
  bakes `AGENTS.md` from the catalog. Files the agent writes,
  captured stderr — agent's responsibility. Deleting an entire
  `<id>/` directory by hand is supported (the next `list` call drops
  the orphan row from the manager's view); editing the baked
  `AGENTS.md` reaches the agent on the next launch but bypasses
  catalog versioning.
- **the runtime adapter** owns its own per-session / per-task state
  outside the workdir entirely (Copilot:
  `~/.copilot/<runtimeSessionId>/`). Glyph never reads it as a
  filesystem path; the typed `Runtime.readMetadata()` /
  `Runtime.readActivity()` / `Runtime.streamActivity()` API surface is
  the only bridge.

### Why the contract matters

This boundary is what gives the storage layer freedom to evolve. Schema
migrations, additional sidecars, JSON → SQLite transitions, even
relocating a file — none of these are breaking changes as long as the
HTTP API surface stays stable. A future runtime that ships its log as
a SQLite row or streams it over a socket fits the same contract
without any change on the glyph side. If you hand-edit a managed
file and break it, that's a `git restore` away (if you're lucky) or a
`rm <file> && glyph restart` away — not a bug report.

## Tech stack

- **TypeScript** (≥ 5.7) with strict + `exactOptionalPropertyTypes`.
- **Node** ≥ 22 (uses native fetch, `node:test` not used — see vitest).
- **pnpm** ≥ 10 workspaces; one `tsconfig.json` per package, downstream
  packages import upstream `.d.ts`.
- **[Hono](https://hono.dev)** for the HTTP server (lightweight, no
  Express baggage; supports streaming responses out of the box).
- **[React](https://react.dev)** + **[Vite](https://vite.dev)** for
  the dashboard (development) → bundled SPA served from the same Hono
  process (production).
- **[Vitest](https://vitest.dev)** for tests; one `vitest.config.ts`
  per package. Tests use `vi.mock` + `vi.spyOn` for module-boundary
  spies.
- **[Biome](https://biomejs.dev)** for lint + format. One config at
  the repo root; CI fails on diff.
- **[esbuild](https://esbuild.github.io)** for the production bundle
  (`pnpm bundle` → `bundle/glyph.js` + `bundle/static/`).
- **[pino](https://getpino.io)** for structured logging — committed
  to as the API surface, not just a transport choice. Every pkg
  takes an optional `logger?: pino.Logger` constructor parameter
  and reaches for pino features (`child(bindings)` for per-request /
  per-component scoping, `redact` for token sanitisation,
  `serializers` for error rendering) directly. Pretty-printed in
  dev, JSON in prod (file destination is always JSON regardless).
  - `silentLogger` is `pino({ level: "silent" })` — the default for
    any optional `logger?` constructor parameter; pino short-circuits
    at the level check so it incurs no allocation cost.
  - Test seam: tests that need to assert on structured log output
    construct a per-test `captureLogger` via pino's
    [`destination`](https://getpino.io/#/docs/api?id=destination)
    API (canonical impl at `packages/server/test/_capture-logger.ts`
    is the simplest example).

## Testing posture

- Every package has its own vitest suite. `pnpm test` runs them all.
- Integration tests live in `packages/<pkg>/test/integration/` and
  use real subprocess spawning where applicable. They run on the same
  CI matrix (Linux / macOS / Windows / Node 22).
- The preferred test seam is **`compose<Entity>Module({ dbFile:
  ":memory:" })`**: opens an in-memory SQLite, runs the real
  drizzle-kit migrations, returns the real service. No mocks of
  the persistence layer; tests assert against actual database
  behaviour (constraint violations, ordering, joins).
- Vitest's `vi.mock` pattern is used to spy on module imports
  when a side-effect needs verification (e.g. confirming the
  service routes a write through the atomic-write helper rather
  than `fs.writeFile` directly).
- Vitest runs in `forks` pool across every pkg. better-sqlite3's
  native binding segfaults on worker-thread teardown on Windows;
  forks isolate per-file with a separate process so the segfault
  becomes a localised failure instead of a workspace-wide outage.

## Coding conventions

- **No `any` outside test stubs.** The repo runs strict TypeScript
  with `exactOptionalPropertyTypes`; if a value is "optional", the
  type is `T | undefined` and the field is conditionally spread, not
  assigned `undefined` directly.
- **Errors are typed.** Domain and application errors are
  discriminated-union atoms (`{ type: "<AtomName>", ... }`) returned
  through neverthrow `Result` / `ResultAsync` — never thrown for
  control flow. Consumers (routes, other use-cases) branch on
  `err.type` via `switch` (see `docs/pkg-template.md#errors`). The
  api layer's Problem envelope maps each `type` to an HTTP status via
  a per-domain table (`packages/api/src/_error-policies/*`).
  Infrastructure-level thrown errors (e.g. `WorkspaceLoadError`,
  `SessionNotFoundError`) live on an allow-list keyed by class name
  (`SAFE_ERROR_NAMES` in `packages/api/src/_http-errors.ts`); anything
  off the list collapses to an opaque `InternalError` to avoid
  leaking host paths. Throwing a bare `new Error(...)` from a
  manager is a smell.
- **Comments explain *why*, not *what*.** A regex is self-explanatory;
  the choice to use `Number.parseInt` over `+` because the input might
  be `"0x10"` is not. Lean toward more comments at decision points,
  fewer at mechanical steps.
- **Atomic writes** for out-of-band JSON files go through
  [`write-file-atomic`](https://github.com/npm/write-file-atomic).
  Plain `writeFile` to a long-lived file is a code-review red flag.

## Adding a new runtime

To add e.g. a Gemini adapter:

1. Implement the `Runtime` interface in `packages/runtime/src/gemini/`
   following the Copilot impl as a reference. Pre-allocating runtimes
   (CLI accepts `--session-id=<arbitrary-uuid>` or equivalent) return
   a fresh UUID from `provision`; discovery-only runtimes return
   `null` and rely on a per-runtime discovery hook to learn the id
   later.
2. Implement `launchHeadless` if the runtime supports unattended
   (non-TTY) task dispatch — required for `glyph task dispatch`.
   Pull agent + skill content from the supplied `catalog` argument
   via `agentEntries` / `skillEntries`; write into the supplied
   `opts.workdir`. Never resolve catalog paths from the resolve result.
3. Implement `readActivity` (and ideally `streamActivity`) to read
   your runtime's per-conversation log end-to-end (find file → read →
   parse → derive headline) and return runtime-neutral `ActivityItem[]`
   plus `result`. Tail-first pagination via `before` / `after` /
   `limit` is mandatory for `readActivity` (omit both directional
   params for the latest `limit` items — what GUI consumers want on
   first load); `streamActivity` honours `opts.signal` for
   cleanup. Implement `readMetadata` if the CLI surfaces a session-
   level display title. The dashboard / CLI / future MCP renders
   `ActivityItem`s without ever seeing your log format or path.
4. Register the runtime in the `RuntimeRegistry` instantiated at
   `packages/server/src/index.ts`.

The dashboard adapts automatically — runtimes are listed via
`/api/runtimes` and the create-session / dispatch-task forms pick
them up.

## Adding a new HTTP route

A route is a **domain zod schema + api route factory + generated
client** trio, kept in sync by the OpenAPI snapshot test — skip a step
and CI fails rather than drifting silently.

1. **Own the request / response shape in the domain package.** Add (or
   reuse) the `Request` / `Response` zod schemas in the owning domain
   pkg's `application/<use-case>.ts` (for example
   `DispatchTaskRequestSchema` in
   `packages/task/src/application/dispatch-task.ts`). These schemas are
   the source of truth for the wire shape.
2. **Declare the route in `@glyphs-ai/api`.** Add a `createRoute(...)`
   entry to the domain's `OpenAPIHono` factory in
   `packages/api/src/routes/<domain>.ts`, wiring the request / response
   schemas (validation is handled by the zod-openapi route definition)
   and the typed error responses — the Problem envelope via
   `respondProblem` plus the domain's table in
   `packages/api/src/_error-policies/`. Add any new user-facing error
   class `name` to `SAFE_ERROR_NAMES`.
3. **Mount it in `@glyphs-ai/server`.** Register the factory in
   `packages/server/src/index.ts`
   (`app.route("/api/<domain>", <domain>Routes(...))`). `server` adds no
   per-route handler of its own — it mounts the api factories and serves
   the spec at `/api/openapi.json`
   (`packages/server/src/routes/_openapi.ts`).
4. **Regenerate the client + snapshot.** Run
   `pnpm --filter @glyphs-ai/sdk gen` to regenerate `@glyphs-ai/sdk`
   from the new OpenAPI spec, then refresh the snapshot guarded by
   `packages/server/test/openapi-snapshot.test.ts`. The dashboard / cli
   import the newly generated operation from `@glyphs-ai/sdk` — no
   manual wiring.

## Adding a new CLI command

A command is a **registrar + result rendering + test** trio. The command
talks to a running server through the typed route above — it never
hand-rolls a `fetch`.

1. **Register the subcommand.** Add it to the relevant registrar in
   `packages/cli/src/registrars/<domain>.ts` (wrap workspace-scoped
   commands with `withWorkspaceFlags`). The action creates a client with
   `makeSdkClient(opts)`, calls the generated `@glyphs-ai/sdk` operation
   for the route (through the `unwrap(...)` helper), and stores the
   response on the command `slot`.
2. **Render the result.** Route the response through the result / output
   seam (`packages/cli/src/result.ts` + `output.ts`) so both the
   human-readable `table` default and `--json` work. Follow the id and
   flag naming conventions documented in
   [`packages/cli/README.md`](../packages/cli/README.md) — reviewers
   reject flags outside that table.
3. **Test it.** Add a spawn / integration test under
   `packages/e2e/test/cli/` (e.g. `spawn-smoke.test.ts`) so the command
   is exercised end-to-end against a real spawned binary.

## Where to look next

- **The paper:
  [*What we believe about agentic systems*](./paradigm.md)** —
  the paradigm glyph implements. Three beliefs, three commitments,
  one extension surface. Read this before proposing architectural
  changes that touch the boundary between code and AI.
- Per-package READMEs — public API surface for each entity:
  - [`@glyphs-ai/workspace`](../packages/workspace/README.md)
  - [`@glyphs-ai/catalog`](../packages/catalog/README.md)
  - [`@glyphs-ai/session`](../packages/session/README.md)
  - [`@glyphs-ai/task`](../packages/task/README.md)
  - [`@glyphs-ai/runtime`](../packages/runtime/README.md)
  - [`@glyphs-ai/api`](../packages/api/README.md)
  - [`@glyphs-ai/server`](../packages/server/README.md)
- [`docs/CONTRIBUTING.md`](./CONTRIBUTING.md) — local setup, the daily
  loop, and the "adding things" pointer map.
- [`docs/RELEASING.md`](./RELEASING.md) — maintainer release procedure.
