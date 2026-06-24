# @glyphs-ai/server

> **Tier:** T3 (Host). See the [tier model](../../docs/architecture.md#tier-model).

The HTTP API surface — a [Hono](https://hono.dev) app that mounts the
workspace registry plus workspace-scoped catalog, session, task,
schedule, and workflow routes. Bundled into the published `glyph`
binary; also runs standalone for development.

The server is a **pure transport adapter** over
[`@glyphs-ai/api`](../api). Every route is parse — dispatch to api or
to the per-workspace runtime — format. Business logic lives in the
entity services; orchestration (cache, spawn, register/rename) lives
in api.

## URL scheme

Workspace-scoped resources live under `/api/workspaces/<wsid>/...`
where `<wsid>` is the workspace's opaque UUID — stable for the
lifetime of the registry entry, so dashboard URLs survive workspace
renames.

The canonical list lives in `@glyphs-ai/contracts`'s `ROUTES` manifest;
`test/route-manifest.test.ts` pins the registered handlers against it.
If this overview drifts from the manifest, the test stays green --
prefer the manifest. Braced rows below group sibling manifest entries.
Workflows are a first-class T1 surface alongside sessions and tasks,
not a task sub-layer.

```text
/api/health                                              GET                      liveness + version (no auth)
/api/config                                              GET                      resolved server config
/api/runtimes                                            GET                      registered runtime kinds + capabilities

/api/workspaces                                          GET POST                list / create
/api/workspaces/current                                  GET PUT                  get / set the most-recently-selected
/api/workspaces/:id                                      GET PATCH DELETE         get / rename / delete (?purge=1)
/api/workspaces/:id/reload                               POST                     force-rebuild per-workspace cache

/api/workspaces/:id/sessions                             GET POST                list / create
/api/workspaces/:id/sessions/:sid                        GET DELETE               get / delete (?purge=1)
/api/workspaces/:id/sessions/:sid/spawn                  POST                     hand-off to terminal spawner

/api/workspaces/:id/tasks                                GET POST                 list / dispatch standalone tasks
/api/workspaces/:id/tasks/:tid                           GET DELETE               get / delete (?purge=1; terminal-only)
/api/workspaces/:id/tasks/:tid/cancel                    POST                     user-initiated cancel
/api/workspaces/:id/tasks/:tid/activity                  GET                      runtime-parsed timeline (tail-paginated)
/api/workspaces/:id/tasks/:tid/activity/stream           GET                      Server-Sent Events live tail
/api/workspaces/:id/tasks/:tid/artifact/:name            GET                      task success.artifacts whitelist download

/api/workspaces/:id/scheduled-tasks                      GET                      list schedule-launched tasks
/api/workspaces/:id/scheduled-workflows                  GET                      list schedule-launched workflows

/api/workspaces/:id/schedules                            GET                      list schedules
/api/workspaces/:id/schedules/task                       POST                     create task-kind schedule
/api/workspaces/:id/schedules/workflow                   POST                     create workflow-kind schedule
/api/workspaces/:id/schedules/preview-cron               GET                      preview an arbitrary (expr, tz)
/api/workspaces/:id/schedules/:sid                       GET DELETE               get / delete
/api/workspaces/:id/schedules/task/:sid                  PATCH                    patch task-kind schedule (RFC 7396 deep-merge on target)
/api/workspaces/:id/schedules/workflow/:sid              PATCH                    patch workflow-kind schedule (RFC 7396 deep-merge on target)
/api/workspaces/:id/schedules/:sid/run                   POST                     manual fire-now
/api/workspaces/:id/schedules/:sid/preview               GET                      next-N fires for this schedule

/api/workspaces/:id/workflows                            GET POST                 list / create workflow
/api/workspaces/:id/workflows/:wfid                      GET DELETE               workflow header / delete workflow (?purge=1)
/api/workspaces/:id/workflows/:wfid/dag                  GET                      full DAG snapshot with taskId enrichment
/api/workspaces/:id/workflows/:wfid/nodes/:nid           GET                      single node with taskId enrichment
/api/workspaces/:id/workflows/:wfid/cancel               POST                     user-initiated workflow cancel
/api/workspaces/:id/workflows/:wfid/artifacts            GET                      list workflow and per-node artifacts
/api/workspaces/:id/workflows/:wfid/artifacts/:encodedPath GET                    stream one artifact
/api/workspaces/:id/workflows/:wfid/edges                POST                     add edge
/api/workspaces/:id/workflows/:wfid/nodes                POST                     add node
/api/workspaces/:id/workflows/:wfid/subgraph             POST                     add nodes and edges atomically
/api/workspaces/:id/workflows/:wfid/nodes/:nid/cancel    POST                     cancel worker-kind node
/api/workspaces/:id/workflows/:wfid/nodes/:nid/respond   POST                     answer a waiting human-kind node
/api/workspaces/:id/workflows/:wfid/finish               POST                     mark workflow terminal
/api/workspaces/:id/workflows/:wfid/edges/:from/:to      DELETE                   delete not-started edge
/api/workspaces/:id/workflows/:wfid/nodes/:nid           DELETE                   delete not-started node
/api/workspaces/:id/workflows/:wfid/nodes/:nid/spec      PATCH                    replace node spec

/api/workspaces/:id/catalog/overview                     GET                      per-workspace counts (skills / agents / mcps, blocked, orphaned)
/api/workspaces/:id/catalog/{skills,agents,mcps}         GET POST                 list entries / install from origin
/api/workspaces/:id/catalog/{skills,agents}/resolve      POST                     two-phase install preview (returns CatalogPlan)
/api/workspaces/:id/catalog/{skills,agents}/:name        GET PATCH PUT DELETE     get / update metadata / update content / remove
/api/workspaces/:id/catalog/{skills,agents}/:name/anchor GET                      raw anchor content (split from entry GET)
/api/workspaces/:id/catalog/{skills,agents,mcps}/:name/sync/resolve POST          plan a sync from the origin (token)
/api/workspaces/:id/catalog/{skills,agents,mcps}/:name/sync POST                  apply a previously-cached sync plan
/api/workspaces/:id/catalog/{agents,skills}/:name/acknowledge-prereqs  POST       mark missing-dep gate cleared
/api/workspaces/:id/catalog/agents/:name/{enable,disable}              POST       toggle agent enabled state
/api/workspaces/:id/catalog/mcps/:name                   GET PUT DELETE           get / update content / remove
```

There is no global catalog mount — switching workspace switches the
catalog the dashboard sees.

## Verb conventions

- **`?purge=1`** on workspace / session / task DELETE. Default (no
  flag) removes only glyph metadata; `purge=1` also wipes the
  entity's sandbox dir. Schedule and catalog DELETEs do NOT honour
  the flag — schedules return a `deletedDispatchCount` summary
  instead, and catalog DELETEs always remove both the row and the
  content file. See [`docs/architecture.md`](../../docs/architecture.md).
- **Time filters canonicalise** any `Date.parse`-able input into ISO
  8601 with a `Z` suffix before forwarding to services; the
  service's lexicographic compare relies on canonical form. Garbage
  input — 400 with a descriptive error.

## Validation pipeline

Every route that accepts a body or query validates it before touching a
service, and the outcome is a small ADT rather than thrown control flow.

- **`ValidationResult<T>`** (`src/routes/_shared.ts`) is the discriminated
  union `ValidationOk<T>` (`{ ok: true, value }`) or `ValidationFail`
  (`{ ok: false, error }`). It is lifted into `_shared.ts` so the
  `schedules` and `workflows` route files share one definition instead of
  each redeclaring the triple. On `ok: false` the route replies `400`
  with the `error` string; on `ok: true` it forwards `value` to the
  service. Helpers like `unknownBodyKey` reject unexpected keys, so a
  URL-implied discriminator (e.g. a target `kind` already fixed by the
  path) cannot be smuggled back in through the body.
- **Per-kind spec validation** lives one layer in, at dispatch time. The
  `@glyphs-ai/workflow` package is kind-agnostic about node specs; the
  per-kind checks run in the api wiring runners
  (`packages/api/src/wiring/`), which throw `WorkflowCoordSpecError`,
  `WorkflowWorkerSpecError`, or `WorkflowHumanSpecError` when a coord /
  worker / human node spec is malformed.
- **`respondError` + `ErrorPolicy`** turn those typed errors into stable
  HTTP responses. Each domain threads an `ErrorPolicy`
  (`src/routes/_error-policies/`) mapping error classes to status codes.
  Only error `name`s on the `SAFE_ERROR_NAMES` allow-list
  (`src/routes/_shared.ts`) have their `.message` surfaced in the
  response body — the three workflow spec errors are on that list;
  anything unmapped collapses to a generic internal error so host paths
  and `fs` strings never leak.

## Per-workspace context

The server holds one `WorkspaceService` process-wide (via
`@glyphs-ai/api`) and lazily mints per-workspace
`{catalog, sessions, tasks, schedules, workflows}` bundles. Each
bundle is a `WorkspaceContext`, resolved through
`application.getContext(id)` and
held by an internal `WorkspaceContextRegistry` private to
`@glyphs-ai/api`. Implicit invalidation happens on workspace deletion
or rename; an explicit `POST /api/workspaces/:id/reload` is also
available for operator-driven reload (e.g. recovering after the
persisted state on disk has been edited externally). Reload is
refused with HTTP 409 + `code=WorkspaceHasLiveTasksError` when the
workspace still has live task subprocesses, since dropping the
cached `TaskService` would orphan the in-flight subprocesses.

## Subprocess env contract

The server populates two env-shaping inputs that the runtime layer
consumes, plus a third per-task layer added downstream:

| Helper                          | Semantics                                          | Honoured by              | Owner            |
| ------------------------------- | -------------------------------------------------- | ------------------------ | ---------------- |
| `buildSubprocessEnvBase(...)`   | Positive: set these in every spawned subprocess    | interactive + headless   | @glyphs-ai/server  |
| `SUBPROCESS_ENV_SCRUB_KEYS`     | Negative: delete these from inherited parent env   | headless only (mergeEnv) | @glyphs-ai/server  |
| `GLYPH_WORKSPACE*` + `GLYPH_WORK_*` | Positive: per-task work-context env, layered on top of the base via `{...base, ...perTask}` | interactive + headless | @glyphs-ai/task + @glyphs-ai/session at dispatch / launch time |

The first two are passed to the `CopilotRuntime` constructor at bootstrap.
The interactive path (`buildInteractiveLaunch` — terminal spawner)
inherits the parent env wholesale and cannot unset, so scrub keys
only take effect on headless launches. The per-task layer is added
inside `TaskService.dispatch` / `SessionService.assembleLaunchEnv` --
see those modules for the exact field list.

## Loopback binding

`assertBindIsSafe` refuses to start the server bound to anything
other than loopback (`127.0.0.1` / `::1` / IPv4-mapped IPv6
loopback). There is no escape hatch and no auth layer; for remote
access, terminate auth elsewhere and reach the server through a
loopback-equivalent (SSH port-forward, reverse proxy with mTLS /
OIDC, mesh VPN). Wildcard binds (`0.0.0.0` / `::`) are NOT accepted
-- set `GLYPH_HOST=127.0.0.1` (the default) to silence the error.

For the `GLYPH_SERVER` env var handed to subprocesses, the
`0.0.0.0` / `::` wildcards (if a future build allowed them) would
be rewritten to `127.0.0.1` so spawned children dial loopback
(Windows refuses outbound `0.0.0.0`); see `subprocess-env.ts`.

## Public API

```ts
runServer(opts?: RunServerOpts): Promise<void>;   // start the HTTP server
RunServerOpts;                                    // typed options bag

// CLI lifecycle helpers (re-exported from `./glyph-home.js`)
DEFAULT_GLYPH_HOME;                             // `~/.glyph` fallback
resolveGlyphHome(env: NodeJS.ProcessEnv): string;
RUNTIME_FILE_NAME;                                // `"runtime.json"`
RuntimeFile;                                      // typed shape of <home>/runtime.json
runtimeFilePath(home: string): string;
LOGS_SUBDIR;                                      // `"logs"`
logsDir(home: string): string;
```

`@glyphs-ai/cli` consumes every member of the "CLI lifecycle helpers"
group for `glyph start` / `status` / `stop` / `connect` / `logs`;
they cannot live in `@glyphs-ai/contracts` because they value-import
`node:os` / `node:path`, and contracts is the SPA-safe surface.

## Graceful shutdown

`SIGTERM` / `SIGINT` triggers:

1. Hono server stops accepting new connections (drains inflight).
2. Tasks: every live subprocess receives `SIGTERM`; manager waits
   for terminal status.
3. `application.close()` (await — closes every per-workspace
   context's SQLite handles, then releases `global.db`).
4. `process.exit(0)`.

A 30s deadline backstops every step in case a downstream hangs.

## Testing

```sh
pnpm --filter @glyphs-ai/server test
```

Vitest runs in `forks` pool.

## License

MIT
