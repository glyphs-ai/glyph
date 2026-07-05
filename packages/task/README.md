# @glyphs-ai/task

> **Tier:** T1 (Modes). See the [tier model](../../docs/architecture.md#tier-model).

T1 headless task execution module. A *task* is a one-shot autonomous agent run:
you give it an agent name, a short single-line `brief`, and an optional
multi-line `details` body; the runtime (contract:
[`@glyphs-ai/runtime`](../runtime)) spawns the agent unattended, and you
read the terminal verdict — `succeeded` / `failed` / `cancelled` — plus
the agent's output and artifacts when it finishes. Sits alongside
[`@glyphs-ai/session`](../session) (interactive) and
[`@glyphs-ai/workflow`](../workflow) (multi-task DAG); workflow nodes
dispatch task rows with `origin: "workflow"`.

Schema-first, Result-based, discriminated-union errors, no throws across
the package boundary. Every use-case implements
`UseCase<Request, Response, Error>` and returns
`UseCaseResult = ResultAsync<Response, Error>`.

## What it does

- **Dispatch** a headless run: resolve + readiness-check the agent, pick a
  task-capable runtime, materialize the on-disk task contract, spawn the
  subprocess, and supervise it to a terminal verdict.
- **Supervise** every live subprocess in-memory (the `TaskSupervisor`):
  classify the exit into a terminal status, collect the agent's output +
  `artifact/` files, persist the transition, and reconcile crashed tasks
  on boot via `recoverOrphanedTasks`.
- **Observe** a task: `getTask` (with a live `lastActiveAt` refresh for
  running tasks), `listTasks` (indexed filters), and the runtime activity
  surface (`getTaskActivity` one-shot + `getTaskActivityStream` live tail).
- **End** a task: `cancelTask` (best-effort SIGTERM, awaits the terminal
  persistence) and `deleteTask` (record removal, optional background purge
  of the workdir + runtime state).
- **Integrate**: origin-keyed reverse-lookups (`hasInFlightByOrigin`,
  `listInFlightByOrigin`, `findLatestByOrigin`, `deleteTerminalByOrigin`,
  `aggregateByOrigin`) for the schedule / workflow wiring. Tasks are
  origin-agnostic: a caller passes its own `(origin, originId)` (e.g. the
  workflow wiring passes `origin: "workflow"` + the node id); the task layer
  never special-cases any origin string.

## Layout

Domain → application → infrastructure; imports flow one way and `index.ts`
only re-exports the per-use-case request / response / error contracts,
the curated domain surface, and `composeTaskModule`.

```
packages/task/src/
  domain/                    pure: no imports outside neverthrow / zod
    task-id.ts               branded TaskId + format schema
    task-status.ts           status enum + TerminalStatus + terminal-status list
    task-origin.ts           who launched the task (open string discriminator)
    task-success.ts          succeeded-payload value schema
    task-failure.ts          failed-payload value schema (execution / internal / cascade)
    task-cancellation.ts     cancelled-payload value schema (user / cascade)
    task-entity.ts           TaskEntity FSM (two-door: create / fromStored)
    task-repository.ts       persistence port + its error atoms
    task-sandbox.ts          on-disk sandbox (workdir) port + its error atoms (reserve/materialize/list/remove)
  application/
    ports/
      agent-resolver.ts      catalog-agent resolution port + atoms
      live-process-registry.ts  live-subprocess index port + atoms
    supervision/             stateful lifecycle concern (CATEGORY container):
      task-supervisor.ts       orchestrates dispatch pipeline / cancel / shutdown /
                               background purge; delegates live handles to the registry.
                               Owns the runDispatch input contracts (RunDispatchArgs /
                               LaunchableRuntime / DEFAULT_RUNTIME) + the ManagerShuttingDown
                               lifecycle atom
      in-memory-live-process-registry.ts  in-memory LiveProcessRegistry impl —
                               pure coordination (watch / kill / drain), no third-party IO
      terminal-decision.ts     pure exit -> terminal-status classifier
      index.ts                 barrel (TaskSupervisor + registry + supervisor contracts)
    use-case.ts              UseCase<Req,Res,Err> + UseCaseResult = ResultAsync
    dispatch-task.ts · cancel-task.ts · delete-task.ts · get-task.ts ·
    list-tasks.ts · get-task-activity.ts · get-task-activity-stream.ts ·
    recover-orphaned-tasks.ts · resolve-artifact-path.ts · and the five
    origin query use-cases (each owns its Request + Response Zod schema +
    Error atoms inline — no shared DTO or error module)
    index.ts                 curated domain surface (TaskId, value schemas, error atoms)
  infrastructure/
    drizzle/                 task-db / schema / migrations / mapper / repository
    file/local-task-sandbox.ts  LocalTaskSandbox (node:fs); owns the on-disk
                             TASK.md / temp / artifact contract
  task-module.ts          composeTaskModule -> TaskModule (DI container)
  index.ts                   public barrel
drizzle/                     generated SQL migrations (committed)
drizzle.config.ts            drizzle-kit config
```

## On-disk

Each task has two stores: queryable metadata in a SQLite row, and an
on-disk workdir for the agent's product.

```
<workspace>/
 workspace.db              # SQLite `tasks` table: one row per task
 tasks/
     <id>/                 # workdir for task <id>
         TASK.md           # `# <brief>` + `details`, written at dispatch
         temp/             # agent scratch space; never surfaced to users
         artifact/         # user-visible files collected at terminal time
         AGENTS.md         # baked by the runtime provisioner
                           # plus any other files the agent produced
```

`<id>` is a short date-prefixed identifier `YYYYMMDD-xxxxxxxx`
(e.g. `20260508-9dfbdf05`). The workdir has no metadata sidecar;
`runtime`, `agent`, `status`, `brief`, `origin`, and the query fields all
come from the row in `tasks`. The user's `brief`/`details` live in
`TASK.md` (never in the spawn argv) so a user-supplied LF cannot truncate
the CLI's argument list on Windows `cmd.exe`; the runtime receives a fixed
single-line ASCII framing prompt that tells the agent to read it.

## Public API

`composeTaskModule` is the DI container a host builds once and dispatches
through. Each use-case is a `<useCase>.execute(request)` returning a
`ResultAsync<Response, Error>`.

```ts
import { composeTaskModule } from "@glyphs-ai/task";

const tasks = await composeTaskModule({
  dbFile: "/abs/path/to/workspace.db",
  agentResolver,            // AgentResolver — adapter over @glyphs-ai/catalog
  contentSource,            // AgentContentSource — catalog bytes for the launch
  runtimeRegistry,          // RuntimeRegistry from @glyphs-ai/runtime
  workspaceDir: "/abs/workspace-dir",
  workspaceId: "<uuid>",
});

await tasks.recoverOrphanedTasks.execute({}); // sweep crashed-before tasks once at boot

const task = (
  await tasks.dispatchTask.execute({
    agent: "writer",
    brief: "Draft the post",
    details: "Tone: warm. Length: ~600 words.",
  })
)._unsafeUnwrap();

await tasks.listTasks.execute({ status: "running", agent: "writer" }); // ListTasksResponse
await tasks.getTask.execute({ id: task.id }); // GetTaskResponse (task view | null)
await tasks.cancelTask.execute({ id: task.id }); // best-effort SIGTERM
await tasks.deleteTask.execute({ id: task.id, purge: false });
await tasks.resolveArtifactPath.execute({ id: task.id, name: "report.html" });

// Activity: one-shot + live tail.
await tasks.getTaskActivity.execute({ id: task.id, limit: 50 });
const stream = (await tasks.getTaskActivityStream.execute({ id: task.id, signal }))._unsafeUnwrap();
if (stream !== null) for await (const item of stream) { /* SSE-style tail */ }

tasks.liveCount();          // in-flight dispatches + live subprocesses
await tasks.shutdown();     // kill + drain live subprocesses
await tasks.close();        // module cleanup: closes the DB
```

## State machine

Statuses are persisted on the row:

```
running → succeeded | failed | cancelled
```

`dispatchTask` creates the task directly in `running` and immediately
spawns the runtime subprocess; the eventual exit folds into a terminal
status. `cancelled` is produced only by `cancelTask`; `failed` covers a
non-zero exit / signal, a manager-side fault, server shutdown, or
orphan recovery. `TaskEntity` is the FSM — each transition returns a fresh
entity or an `InvalidTransition` atom.

## Env layering

This package does NOT own the cross-cutting subprocess env
(`GLYPH_SERVER`, `GLYPH_SHARED_DIR`, …); the runtime adapter owns it via
`CopilotRuntimeConfig.subprocessEnvBase`. Dispatch layers per-task
work-context env (`GLYPH_WORKSPACE`, `GLYPH_WORKSPACE_DIR`,
`GLYPH_WORK_KIND=task`, `GLYPH_WORK_ID=<id>`, `GLYPH_WORK_DIR=<workdir>`)
on top. A caller-supplied `subprocessEnv` that collides with one of those
five kernel keys is rejected pre-spawn (`DispatchKernelEnvCollision`).

## Errors

Task use-cases return discriminated-union error objects through
`ResultAsync`, for example:

- `TaskNotFound` — unknown task id
- `InvalidTransition` — impossible FSM transition for the current status
- `AgentNotFound` / `AgentResolutionFailed` / `EntryNotReady` — launch
  target cannot be resolved or is not ready
- `RuntimeDoesNotSupportTasks` / `RuntimeHeadlessLaunchFailed` — runtime
  selection or subprocess launch failure
- `WorkdirReservationFailed` / `WorkdirMaterializationFailed` /
  `DatabaseUnavailable` — filesystem or persistence failure

## Testing

```sh
pnpm --filter @glyphs-ai/task typecheck
pnpm --filter @glyphs-ai/task test
```

Vitest runs in `forks` pool (better-sqlite3's native binding segfaults on
worker-thread teardown on Windows).

## License

MIT
