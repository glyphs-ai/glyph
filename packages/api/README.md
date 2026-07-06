# @glyphs-ai/api

> **Tier:** T2 (Application).

The **T2 Application layer (orchestration)** — glyph's composition
root that wires T0 foundations (`workspace`, `catalog`, `runtime`,
`schedule`, `terminal`) and T1 execution modes (`session`, `task`,
`workflow`) into per-workspace runtime contexts. It also owns the HTTP
route factories and the shared error / Problem-envelope surface; the
`@glyphs-ai/api` barrel re-exports both so the in-process server boot
path (`@glyphs-ai/server`) imports orchestration and routes from one
specifier.

`@glyphs-ai/dashboard` and `@glyphs-ai/cli` must NOT import from
`@glyphs-ai/api` — they use the HTTP transport and consume response
shapes from the generated `@glyphs-ai/sdk` client. The structural
fence is enforced by
`packages/e2e/test/architecture/tier-invisibility.test.ts`.

## Internal layout

```
packages/api/src/
├── application.ts            ← Application interface + composeApplication
├── workspace-context.ts      ← WorkspaceContext + WorkspaceContextRegistry
├── routes/                   ← per-domain OpenAPIHono route factories; each
│                               co-locates its own zod request/response schemas
├── schemas/
│   └── problem.ts            ← the shared Problem Details error envelope
│                               (zod schema + the `toProblem` assembler)
├── _http-errors.ts           ← Problem-response helpers + SAFE_ERROR_NAMES
├── _http-helpers.ts          ← shared OpenAPIHono app factory + OpenAPI finalizer
├── _error-policies/          ← per-domain error tables (code → status/title)
├── wiring/                   ← per-kind handler wiring (cross-package glue)
│   ├── schedule-task-handler.ts         ← schedule "task" kind → TaskModule use-cases
│   ├── schedule-workflow-handler.ts     ← schedule "workflow" kind → WorkflowModule
│   ├── workflow-coord-task-runner.ts    ← workflow coordinator node → TaskModule use-cases
│   ├── workflow-human-node-runner.ts    ← workflow human node → gate awaiting the respond API
│   └── workflow-worker-task-runner.ts   ← workflow worker node → TaskModule use-cases
└── index.ts                  ← public barrel (orchestration + route
                                factories + error/Problem surface)
```

## Public API

The package exports:

- `composeApplication` and the `Application` type.
- `WorkspaceContext`, `WorkspaceContextState`, and the workspace
  lifecycle errors `WorkspaceHasLiveTasksError` / `WorkspaceLoadError`.
- The workflow spec-validation error classes:
  `WorkflowCoordAgentNotCapableError`, `WorkflowCoordSpecError`,
  `WorkflowWorkerSpecError`, `WorkflowWorkerNotInCoordMenuError`, and
  `WorkflowHumanSpecError`.
- The mountable route factories (`sessionsRoutes`, `tasksRoutes`,
  `workflowsRoutes`, `catalogRoutes`, the `schedules*Routes`,
  `configRoutes`, `healthRoutes`, `runtimesRoutes`) plus the shared HTTP
  error / Problem-envelope surface (`respondProblem`, `respondError`,
  `SAFE_ERROR_NAMES`, the per-domain error policies, and `Problem` /
  `toProblem` / `validationProblem` from `src/schemas/problem.ts`).

```ts
import { composeApplication } from "@glyphs-ai/api";

const app = await composeApplication({
  workspace: {
    dbUrl: "file:/abs/global.db",                // libsql URL (":memory:" in tests)
    defaultWorkspaceParent: "/abs/home/workspaces",
  },
  runtimeRegistry,                               // RuntimeRegistry
  logger,                                        // optional pino
});

app.workspace;                                   // WorkspaceModule — the workspace use-cases (register / rename / list / getLastOpenedId / …)

// Cross-cutting mutations that also invalidate the per-workspace context
await app.renameWorkspace(workspaceId, { name });
await app.unregisterWorkspace(workspaceId);      // idempotent
await app.reloadWorkspace(workspaceId);

// Per-workspace contexts
const ctx = await app.getContext(workspaceId);   // WorkspaceContext | null
ctx.workspace;                                   // Workspace (the metadata row)
ctx.catalog;                                     // CatalogModule
ctx.sessions;                                    // SessionModule (use-cases)
ctx.tasks;                                       // TaskModule
ctx.schedules;                                   // ScheduleModule
ctx.workflows;                                   // WorkflowModule
await ctx.sessions.spawnInteractive.execute({ id, remote? }); // ResultAsync<SpawnInteractiveResponse>

app.loadedContexts();                            // snapshot of currently-loaded contexts
app.peekContextState(workspaceId);               // "cached" | "loading" | "unloaded" | "not-registered"

await app.close();                               // closes every per-workspace context, then the global registry
```

The cross-cutting mutations that must invalidate a cached per-workspace
context (`renameWorkspace`, `unregisterWorkspace`, `reloadWorkspace`)
are exposed as `Application` methods. Registration and the read-only
use-cases stay on `app.workspace` (the `WorkspaceModule`) and are called
as `app.workspace.<useCase>.execute(...)`.

## WorkspaceContext fields

Field naming follows the Stripe convention — singular for a
single-entity registry, plural for a collection / surface that exposes
list-like operations:

| Field       | Type                  | Why singular / plural                                      |
| ----------- | --------------------- | ---------------------------------------------------------- |
| `workspace` | `Workspace`           | one workspace                                              |
| `catalog`   | `CatalogModule`       | one catalog (the registry)                                 |
| `sessions`  | `SessionModule`       | many sessions per workspace; DI container of use-cases     |
| `tasks`     | `TaskModule`          | many tasks per workspace; DI container of use-cases        |
| `schedules` | `ScheduleModule`      | many schedules per workspace; cron-driven task dispatch substrate |
| `workflows` | `WorkflowModule`      | many workflows per workspace; DAG orchestration substrate  |
| `close()`   | `() => Promise<void>` | closes the five module handles in reverse-of-compose order; idempotent |

`sessions.spawnInteractive.execute({ id, remote? })` (a use-case on the
`SessionModule` from `@glyphs-ai/session`) builds the session's
interactive launch command and immediately hands it to the injected
`Spawner` (in production, `@glyphs-ai/terminal`'s `localSpawner`, passed
through by `composeApplication`). The returned `display` field is
always populated so callers can show a copy-paste command even on spawn
failure. The outcome is a discriminated union (`ok: true` with a
launcher, or `ok: false` with `error` / `code`).

`ctx.schedules.engine.registerKind("task", ...)` is wired automatically by
`composeApplication` (via `makeTaskKindHandler`); callers don't need
to re-register the task kind on a freshly-loaded context.

`ctx.workflows` is composed after the task and schedule modules and is
wired with coordinator and worker node runners that dispatch through the
same `TaskModule` use-cases. Callers use `WorkflowModule` for DAG lifecycle
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

`src/schemas/problem.ts` holds the [zod](https://zod.dev) schema for the
shared **Problem Details** error envelope — the single wire shape every
HTTP error response carries. It is **plain, transport-agnostic zod** — no
`hono` or `@hono/zod-openapi` import — so the schema layer stays free of
any HTTP-transport dependency, and `@glyphs-ai/server` projects it into
the OpenAPI 3.1 document as `components/schemas/Problem`.

Per-route request / response schemas are **co-located inline** in their
`src/routes/*.ts` module (there is no shared per-domain schema subtree).
Each route builds its `@hono/zod-openapi` operation from those inline
schemas, and each schema's wire type is its `z.infer`, so the runtime 400
request validation and the documented response shapes derive from one
definition and cannot drift. `@glyphs-ai/server` mounts the route
factories and serves the assembled document at `/api/openapi.json`
(Swagger UI at `/api/docs`).

```ts
import { toProblem, type Problem } from "@glyphs-ai/api";

const problem: Problem = toProblem({
  status: 409,
  title: "Entry not ready",
  detail: "coord node is still running",
  code: "EntryNotReady",
});
```

## Tier

`@glyphs-ai/api` is the **T2 Application layer (orchestration)** in
glyph's tier model. Its sibling at T2 is `@glyphs-ai/sdk` (the generated
client). T0
(foundations: `catalog`, `runtime`, `schedule`, `terminal`,
`workspace`) and T1 (execution modes: `session`, `task`, `workflow`)
sit below; T3 (`server`) and T_top (`dashboard`, `cli`) sit above.

## Layering

`@glyphs-ai/api` MAY import (value or type):

- T0/T1 packages it composes: `@glyphs-ai/workspace`,
  `@glyphs-ai/catalog`, `@glyphs-ai/session`, `@glyphs-ai/task`,
  `@glyphs-ai/workflow`, `@glyphs-ai/runtime`, `@glyphs-ai/schedule`,
  and `@glyphs-ai/terminal` (for `localSpawner`, injected into
  `composeSessionModule` as the `spawner`).

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
