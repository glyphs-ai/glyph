# @glyphs-ai/session

> **Tier:** T1 (Modes). See the [tier model](../../docs/architecture.md#tier-model).

T1 interactive-session registry. Each session is a runtime-provisioned
sandbox — by default an on-disk workdir — for one agent (the runtime
contract is [`@glyphs-ai/runtime-v2`](../runtime-v2)). This package
**organizes** those sandboxes and exposes the `spawnInteractive`
use-case that hands a session's launch command to an injected
`Spawner`. The concrete spawner is `@glyphs-ai/terminal`'s
`localSpawner`; this package depends only on the `Spawner` interface
(type-only) and `@glyphs-ai/api` injects the implementation through
`composeApplication`.

## Why

For interactive use, the [GitHub Copilot CLI](https://github.com/github/copilot-cli)
is the chat UI. glyph's job is to:

- prepare a workdir with an agent baked in (the runtime adapter's
  `provision` step pulls bytes from the catalog)
- remember which workdirs exist, what agent each was baked from, and
  the opaque `runtimeSessionId` the runtime returned (this package)
- give callers the exact incantation to launch / resume the runtime
  in a workdir (`buildInteractiveLaunch`)
- hand the incantation to the injected `Spawner` (`spawnInteractive`)
  and return the discriminated-union outcome the dashboard / CLI
  consume on `POST /sessions/:id/spawn`
- surface runtime-side display metadata (title / lastActiveAt) in
  `listSessions` / `getSession` by calling the runtime's optional
  `readMetadata` hook

`spawnInteractive` never rejects: any build- or spawn-side failure is
folded into an `{ ok: false, error, code, display }` result so callers
always have a copy-paste `display` fallback.

## Layout

Schema-first, Result-based, discriminated-union errors. Domain →
application → infrastructure; imports flow one way and `index.ts` only
re-exports the use-case wire contracts plus `composeSessionModule`.

```
packages/session/src/
  domain/                    pure: no imports outside neverthrow / zod
    session-id.ts            branded SessionId + format schema
    session-entity.ts        SessionEntity (two-door: rehydrate / create)
    session-repository.ts    persistence port + its error atoms
    session-sandbox.ts       sandbox port + its error atoms (resolve/create/remove)
  application/
    ports/
      agent-resolver.ts      catalog-agent resolution port + atoms
    use-case.ts              UseCase<I,O,E> + UseCaseResult = ResultAsync
    create-session.ts        mint id + provision + persist (rollback on failure)
    list-sessions.ts         project + refresh + filter + sort
    get-session.ts           read one (live activity refresh)
    delete-session.ts        archive (row only) / purge (state + sandbox)
    build-interactive-launch.ts  assemble LaunchCommand + work-context env
    spawn-interactive.ts     build + spawn, folded into one result
    index.ts                 curated domain surface (SessionId + error atoms)
  infrastructure/
    drizzle/                 session-db / schema / migrations / mapper / repository
    file/local-session-sandbox.ts  LocalSessionSandbox (node:fs)
  session-module.ts          composeSessionModule → SessionModule (DI container)
  index.ts                   public barrel
drizzle/                     generated SQL migrations (committed)
drizzle.config.ts            drizzle-kit config
```

## On-disk

Each session has two stores: queryable metadata in a SQLite row, and
an on-disk workdir for the agent's actual product.

```
<workspace>/
 workspace.db              # SQLite `sessions` table: one row per session
 sessions/
     <id>/                 # workdir for session <id>
         AGENTS.md         # baked by the runtime provisioner
         .github/skills/   # and whatever else the provisioner wrote
                           # plus anything the agent itself produces
```

`<id>` is a short date-prefixed identifier:

```
YYYYMMDD-xxxxxxxx
e.g. 20260508-9dfbdf05
```

The 8-hex suffix gives ~4 billion values per day, more than enough
for ad-hoc creation. The workdir contains **no metadata sidecar
file**. `agent` is persisted from the catalog's canonical FQN at
create time; `runtime` / `createdAt` / `runtimeSessionId` /
`lastLaunchMode` also come from the row in the workspace's `sessions`
table. The directory name is the **only source of truth for the
session id**.

> Why SQLite for session metadata (and FS for the workdir)? The
> project-wide rule: queryable structured data → SQLite; opaque
> blobs / agent product → FS. (Full rationale in
> [docs/architecture.md](../../docs/architecture.md#backend-selection-when-sqlite).)

## Public API

`composeSessionModule` is the DI container a host builds once and
dispatches through. Each use-case is a `<useCase>.execute(request)`
returning a `ResultAsync<Response, Error>`.

```ts
import { composeSessionModule } from "@glyphs-ai/session";

const session = await composeSessionModule({
  dbFile: "/abs/path/to/workspace.db",
  agentResolver,            // AgentResolver — adapter over @glyphs-ai/catalog
  contentSource,            // AgentContentSource — catalog bytes for provision
  runtimeRegistry,          // RuntimeRegistry from @glyphs-ai/runtime-v2
  spawner,                  // Spawner from @glyphs-ai/terminal (localSpawner)
  workspaceDir: "/abs/workspace-dir",
  workspaceId: "<uuid>",
});

const created = (await session.createSession.execute({ agent: "demo-agent" }))._unsafeUnwrap();

// Build the launch command without spawning a process.
const cmd = (await session.buildInteractiveLaunch.execute({ id: created.id }))._unsafeUnwrap();
console.log(cmd.display);
//  cd "/.../sessions/20260508-9dfbdf05" && copilot --session-id=<id> --yolo

// One-shot: build the launch AND hand it to the injected Spawner.
// Never rejects; `display` is always populated for a copy-paste fallback.
const result = (await session.spawnInteractive.execute({ id: created.id }))._unsafeUnwrap();
if (result.ok) console.log("launched in", result.launcher);
else console.error(result.code, result.error, result.display);

await session.listSessions.execute({});                 // SessionView[]
await session.getSession.execute({ id: created.id });   // SessionView | null
await session.deleteSession.execute({ id: created.id, purge: false });

await session.close();
```

Resume is the same call as launch — once a `runtimeSessionId` exists,
`buildInteractiveLaunch` emits `--session-id=<id>`; for a fresh session
it emits `--yolo` with no id. `{ remote: true }` produces a
remote-friendly variant when the runtime supports it.

## Env layering

The session package does NOT own the cross-cutting subprocess env
(`GLYPH_SERVER`, `GLYPH_SHARED_DIR`, …); the runtime adapter owns it
via `CopilotRuntimeConfig.subprocessEnvBase`. The
`buildInteractiveLaunch` use-case layers per-session work-context env
(`GLYPH_WORKSPACE`, `GLYPH_WORKSPACE_DIR`, `GLYPH_WORK_KIND=session`,
`GLYPH_WORK_ID=<id>`, `GLYPH_WORK_DIR=<workdir>`) on top of whatever
the runtime returned.

## What this package does NOT do

- Implement terminal launching. `spawnInteractive` calls an *injected*
  `Spawner`; the impl is `@glyphs-ai/terminal`'s `localSpawner`
  (production) or any test fake. Session depends only on the `Spawner`
  interface (type-only), never the concrete launcher.
- Track headless task execution or workflow orchestration. Those are
  separate T1 packages: [`@glyphs-ai/task`](../task) and
  [`@glyphs-ai/workflow`](../workflow).
- Stream events from Copilot. The Copilot CLI handles the chat UI
  itself.

## Caveats

- **One Copilot session per glyph workdir**. Provision pre-allocates
  a `runtimeSessionId` and threads it through `--session-id=<id>` on
  every launch — first launch creates the Copilot session, subsequent
  launches resume the same one.
- **`deleteSession({ purge: true })`** may fail with `EBUSY` on Windows
  if Copilot currently has the session open. The error is surfaced as
  `SandboxRemovalFailed` / `RuntimeStateDeletionFailed`; the metadata
  row is left intact.

## Testing

```sh
pnpm --filter @glyphs-ai/session typecheck
pnpm --filter @glyphs-ai/session test
```

Vitest runs in `forks` pool (better-sqlite3's native binding
segfaults on worker-thread teardown on Windows).

## License

MIT
