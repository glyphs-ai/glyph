# @glyphs-ai/api

> **Tier:** T2 (Application). See the [tier model](../../docs/architecture.md#tier-model).

The **T2 Application layer (orchestration)** — glyph's composition
root that wires T0 foundations (`workspace`, `catalog`, `runtime`,
`schedule`, `terminal`) and T1 execution modes (`session`, `task`,
`workflow`) into per-workspace runtime contexts. Cross-package wire
contracts (HTTP route catalog, request / response DTOs, out-of-band IPC
files, `GLYPH_HOME` resolution) live in this package's own `wire/`
surface; the `@glyphs-ai/api` barrel re-exports `wire/` so the
in-process server boot path (`@glyphs-ai/server`) imports orchestration
and contracts from one specifier.

`@glyphs-ai/dashboard` and `@glyphs-ai/cli` must NOT import from
`@glyphs-ai/api` — they use the HTTP transport and import wire shapes
from the generated `@glyphs-ai/sdk` client (the structural fence is
enforced by
`packages/e2e/test/architecture/tier-invisibility.test.ts`).

Orchestration (`composeApplication`, `WorkspaceContext`) and wire
contracts (routes, request / response shapes, path helpers) both live
in this package: orchestration in `src/`, the wire surface in
`src/wire/`. The surfaces (`@glyphs-ai/dashboard`, `@glyphs-ai/cli`)
reach the wire shapes through the generated `@glyphs-ai/sdk` client, a
structural fence against pulling orchestration code into their
bundles. See
[`docs/architecture.md § Tier model`](../../docs/architecture.md#tier-model).

## Internal layout

```
packages/api/src/
├── application.ts            ← Application interface + composeApplication
├── workspace-context.ts      ← WorkspaceContext + WorkspaceContextRegistry
├── schemas/                  ← zod wire schemas, one module per domain; transport-agnostic single source of truth for the server's OpenAPI spec and the inferred wire types (z.infer)
│   └── index.ts              ← schemas barrel (re-exported from the package root)
├── wiring/                   ← per-kind handler wiring (cross-package glue)
│   ├── schedule-task-handler.ts         ← schedule "task" kind → TaskService
│   ├── schedule-workflow-handler.ts     ← schedule "workflow" kind → WorkflowService
│   ├── workflow-coord-task-runner.ts    ← workflow coordinator node → TaskService
│   ├── workflow-human-node-runner.ts    ← workflow human node → gate awaiting the respond API
│   └── workflow-worker-task-runner.ts   ← workflow worker node → TaskService
└── index.ts                  ← public barrel (orchestration + the
                                wire/ surface)
```

Wire contracts (routes, response shapes, path helpers, etc.) live in
`packages/api/src/wire/` — the barrel re-exports them so `server` can
import orchestration and wire types from a single specifier.

## Public API

The package exports:

- `composeApplication` and `Application`.
- `WorkspaceContext` and `WorkspaceHasLiveTasksError`.
- Schedule validation error: `TaskScheduleTargetError`.
- Workflow public validation errors: `WorkflowCoordAgentNotCapableError`,
  `WorkflowCoordSpecError`, and `WorkflowWorkerSpecError`.
- Every public wire contract from the `wire/` surface.
- Every wire **schema** from `src/schemas/` (the zod source of truth
  the server projects to OpenAPI; see [Wire schemas](#wire-schemas)).

```ts
import { composeApplication } from "@glyphs-ai/api";

const app = await composeApplication({
  workspace: { dbFile: "/abs/global.db" },
  runtimeRegistry,                              // RuntimeRegistry
  defaultWorkspaceParent: "/abs/home/workspaces",
  logger,                                       // optional pino
});

app.workspaceService;                            // WorkspaceService — direct access for read-only listing / getLastOpenedId / etc.

// Orchestration (Stripe-style hybrid opts)
await app.registerWorkspace({ name, workspaceDir? });
await app.renameWorkspace(workspaceId, { newName });
await app.unregisterWorkspace(workspaceId, { purge? });
await app.reloadWorkspace(workspaceId);

// Per-workspace contexts
const ctx = await app.getContext(workspaceId);   // WorkspaceContext | null
ctx.workspace;                                   // Workspace
ctx.catalog;                                     // CatalogService
ctx.sessions;                                    // SessionService
ctx.tasks;                                       // TaskService
ctx.schedules;                                   // ScheduleService
ctx.workflows;                                   // WorkflowService
await ctx.sessions.spawnInteractive(sid, { remote? }); // SpawnSessionResult

app.loadedContexts();                            // snapshot of currently-loaded contexts

await app.close();                               // closes every per-workspace context, then the global registry
```

Orchestration mutations (`registerWorkspace`, `renameWorkspace`,
`unregisterWorkspace`, `reloadWorkspace`) go through the `Application`
methods (which invalidate the per-workspace context) rather than
calling `workspaceService.register` etc. directly.

## WorkspaceContext fields

Field naming follows the Stripe convention — singular for a
single-entity registry, plural for a collection / surface that exposes
list-like operations:

| Field       | Type                  | Why singular / plural                                      |
| ----------- | --------------------- | ---------------------------------------------------------- |
| `workspace` | `Workspace`           | one workspace                                              |
| `catalog`   | `CatalogService`      | one catalog (the registry)                                 |
| `sessions`  | `SessionService`      | many sessions per workspace; service is the collection     |
| `tasks`     | `TaskService`         | many tasks per workspace                                   |
| `schedules` | `ScheduleService`     | many schedules per workspace; cron-driven task dispatch substrate |
| `workflows` | `WorkflowService`     | many workflows per workspace; DAG orchestration substrate  |
| `close()`   | `() => Promise<void>` | closes the five service handles in reverse-of-compose order; idempotent |

`sessions.spawnInteractive(sid, { remote? })` (a method on
`SessionService` from `@glyphs-ai/session`) builds the session's
interactive launch command via `SessionService.buildInteractiveLaunch`
and immediately hands it to `@glyphs-ai/terminal`'s `spawnTerminal`.
The returned `display`
field is always populated so callers can show a copy-paste command
even on spawn failure. The result type `SpawnSessionResult` is
canonical in `@glyphs-ai/session` — import it from there directly.

`ctx.schedules.registerKind("task", ...)` is wired automatically by
`composeApplication` (via `makeTaskKindHandler`); callers don't need
to re-register the task kind on a freshly-loaded context.

`ctx.workflows` is composed after the task and schedule services and is
wired with coordinator and worker node runners that dispatch through the
same `TaskService`. Callers use `WorkflowService` for DAG lifecycle
operations; they do not register runners manually.

## Concurrency invariants

Per-workspace context resolution is concurrency-safe: a second
`getContext(workspaceId)` racing the first load awaits the same in-flight
promise. `reloadWorkspace(workspaceId)` first awaits any in-flight load, then
closes and rebuilds — refused with `WorkspaceHasLiveTasksError` if
the cached context's `tasks.liveCount() > 0`. `Application.close()`
drains in-flight loads and closes every loaded context before
disposing the global registry, so callers don't have to remember the
ordering.

The internal `WorkspaceContextRegistry` class is the source-of-truth
holder of live SQLite handles, task supervisors, workflow engines, and
SSE event buses. It is **not** an optimisation cache that can be
silently dropped — dropping entries without `close()` leaks live
resources. The class is intentionally not exported from
`@glyphs-ai/api`; all access goes through `Application` methods.

## Wire schemas

`src/schemas/` holds the [zod](https://zod.dev) schemas for every HTTP
wire shape, one module per domain (`health`, `runtimes`,
`server-config`, `workspaces`, `sessions`, `tasks`, `schedules`,
`workflows`, `catalog`). They are **plain, transport-agnostic zod** —
no `hono` or `@hono/zod-openapi` import — so this package stays free of
any HTTP-transport dependency. `@glyphs-ai/server` imports them and
projects them to an OpenAPI 3.1 document (served at `/api/openapi.json`,
with Swagger UI at `/api/docs`); the schemas are the single source of
truth for both the documented response shapes and the runtime 400
request validation.

Each schema's wire type is its `z.infer` — exported alongside the schema
(e.g. `export type HealthResponse = z.infer<typeof HealthResponseSchema>`).
The runtime validator and the TS type derive from one definition, so they
cannot drift.

```ts
import { HealthResponseSchema, type HealthResponse } from "@glyphs-ai/api";

HealthResponseSchema.parse(payload); // runtime validation
type T = typeof HealthResponseSchema; // OpenAPI projection input (in server)
```

## Tier

`@glyphs-ai/api` is the **T2 Application layer (orchestration)** in
glyph's tier model
(see [`docs/architecture.md § Tier model`](../../docs/architecture.md#tier-model)).
Its sibling at T2 is `@glyphs-ai/sdk` (the generated client). T0
(foundations: `catalog`, `runtime`, `schedule`, `terminal`,
`workspace`) and T1 (execution modes: `session`, `task`, `workflow`)
sit below; T3 (`server`) and T_top (`dashboard`, `cli`) sit above.

## Layering

`@glyphs-ai/api` MAY import (value or type):

- Its own `wire/` surface (re-exported from the public barrel).
- T0/T1 packages it composes: `@glyphs-ai/workspace`,
  `@glyphs-ai/catalog`, `@glyphs-ai/session`, `@glyphs-ai/task`,
  `@glyphs-ai/workflow`, `@glyphs-ai/runtime`, `@glyphs-ai/schedule`,
  and `@glyphs-ai/terminal` (for `spawnTerminal`, injected into
  `composeSessionModule` as the canonical `SpawnFn`).

`@glyphs-ai/api` MUST NOT import:

- `@glyphs-ai/server` — server depends on api, not the reverse.
- `@glyphs-ai/dashboard`, `@glyphs-ai/cli` — surfaces use HTTP and
  `@glyphs-ai/sdk`; they must not depend on api.

## Testing

```sh
pnpm --filter @glyphs-ai/api typecheck
pnpm --filter @glyphs-ai/api test
```

Vitest runs in `forks` pool.

## License

MIT
