# @glyphs-ai/workspace

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

A *workspace* is a user-chosen directory that holds glyph's
per-project state. This package manages the global registry: a single
`$GLYPH_HOME/global.db` SQLite table mapping opaque UUIDs to absolute
paths, plus provisioning each workspace's root directory at
registration. Sibling packages create and own the per-domain subdirs
(`sessions/`, `tasks/`, `workflows/`) and the per-workspace
`workspace.db`. The directory is normally user-chosen but can also be
auto-allocated under `$GLYPH_HOME/workspaces/<uuid>/` when the caller
doesn't specify one. The global registry stores each workspace's
display name + last-opened timestamp; there is no per-workspace
metadata sidecar file.

## Layout

```
packages/workspace/src/
  domain/
    workspace-entity.ts        WorkspaceEntity (pkg-owned domain shape)
    workspace-id.ts            WorkspaceId schema + branded type
    workspace-name.ts          WorkspaceName schema + branded type
    workspace-repository.ts    repository port (write-side: get/save/delete) + error atoms
    workspace-provisioner.ts   workspace-root provisioner port + error atom
  application/
    *.ts                       one use-case class per operation
    workspace-public.ts        curated domain/error surface exported by index.ts
  infrastructure/drizzle/
    workspace-schema.ts        Drizzle table def (private; only types exported)
    workspace-db.ts            openWorkspaceDb() factory + Db handle type
    workspace-migrations.ts    applyWorkspaceMigrations
    workspace-repository.ts    Drizzle write-side adapter (get/save/delete)
    workspace-queries.ts       Drizzle read-side adapter (query() + workspaces table)
  infrastructure/file/
    local-workspace-provisioner.ts  ensures the workspace root dir exists
  workspace-module.ts          composeWorkspaceModule({ db, defaultWorkspaceParent, logger? })
  index.ts                     public barrel (compose + use-case contracts + curated domain types)
drizzle/                       generated SQL migrations (committed)
drizzle.config.ts              drizzle-kit config
```

## Public API

The `.` entrypoint exports the composition surface, per-use-case wire
contracts, and the curated cross-use-case domain/error surface:

```ts
import { composeWorkspaceModule, openWorkspaceDb } from "@glyphs-ai/workspace";

// The caller (assembler) opens the DB and owns its lifecycle. `url` is a
// libsql URL — a `file:` URL in production, `":memory:"` in tests.
const { db, close } = await openWorkspaceDb({ url: "file:///abs/path/to/global.db" });
const workspace = await composeWorkspaceModule({
  db,
  defaultWorkspaceParent: "/abs/path/to/$GLYPH_HOME/workspaces",
});

// Reads
await workspace.listWorkspaces.execute({});                  // Result<Workspace[], E>
await workspace.getWorkspace.execute({ id });                // Result<Workspace | null, E>
await workspace.getLastOpenedWorkspace.execute({});          // Result<Workspace | null, E>
await workspace.getLastOpenedWorkspaceId.execute({});        // Result<{ id: string | null }, E>

// Writes
await workspace.registerWorkspace.execute({ name, workspaceDir }); // workspaceDir optional
await workspace.openWorkspace.execute({ id });
await workspace.renameWorkspace.execute({ id, name });
await workspace.unregisterWorkspace.execute({ id });

await close();                                           // caller closes the libsql handle
```

DTOs, schemas, and error unions are exported from the package root:

```ts
import {
  WorkspaceError,
  WorkspaceIdSchema,
  WorkspaceNameSchema,
  RegisterWorkspaceRequestSchema,
  type ListWorkspacesResponse,
  type RegisterWorkspaceRequest,
} from "@glyphs-ai/workspace";
```

The module owns instantiation. Implementation details are
package-internal. Consumers call the composed use-case instances.

`listWorkspaces.execute({})` returns workspaces ordered by
`lastOpenedAt DESC`, with ties broken by `createdAt DESC` then `id ASC`
(so identical-ms timestamps resolve to the lowest UUID).

## On-disk wire format

```sql
-- $GLYPH_HOME/global.db
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY NOT NULL,
  workspace_dir   TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_opened_at  TEXT
);
CREATE UNIQUE INDEX workspaces_workspace_dir_unique ON workspaces (workspace_dir);
```

The workspace with the greatest `last_opened_at` is what
`getLastOpenedWorkspace.execute({})` returns; it's the registry's
"current" workspace from the user's POV.
`registerWorkspace.execute(...)` sets `last_opened_at = now`
(registration is implicit first-open); `openWorkspace.execute({ id })`
updates it on subsequent opens.
`ORDER BY last_opened_at DESC` pushes never-opened rows last
(SQLite's default NULL-sort under DESC).

Per-workspace metadata (`name`, `createdAt`) lives in the same
`workspaces` row — there is no `<workspace>/workspace.json` sidecar.

## Errors

Workspace errors are discriminated-union values exported from the
package root:

```
WorkspaceError
├── WorkspaceNotFound         id has no entry in the registry
├── WorkspacePathConflict     workspaceDir already registered
├── DatabaseUnavailable       registry-level storage failure
└── ProvisioningFailed        workspace root dir could not be created
```

These are **precondition / conflict / infrastructure** errors. Input
*format* validation (id grammar, name rules, absolute-path) is not a
typed error: use-cases parse inputs with their Zod schemas, so a
malformed id / name / workspaceDir raises a `ZodError`, which the api
layer maps to a 400 `ValidationError` envelope.

The write-side repository's `get(id)` returns the entity directly and
signals a missing row with `WorkspaceNotFound`. `rename` / `open` call
`get` and surface that as their caller-facing error; `unregister`
deletes by id without a prior `get`, and the delete is a no-op for an
unknown id (idempotent success).

Change-tracking lives in the repository, not the entity. `WorkspaceEntity`
is a pure rich-domain object (`create` / `rehydrate` + mutators, no
persistence state). The repository keeps a `WeakMap<WorkspaceEntity, Row>`:
`get` snapshots the loaded row against the returned entity; `save` looks the
entity up — absent ⇒ INSERT (a freshly `create()`d aggregate), present ⇒
diff the current row against the snapshot and UPDATE only the changed
columns (or no-op). Persisting a mutation is therefore always `get` →
mutate → `save`; the `WeakMap` releases entries when the entity is
garbage-collected, so there is nothing to dispose per request.

Workspace precondition and infrastructure failures are
discriminated-union values returned in the use-case `Err` channel.
`getWorkspace.execute({ id })` raises a `ZodError` for a malformed id
and returns `Ok(null)` only for a valid-but-unknown id.

Concurrency: `registerWorkspace`'s pre-flight conflict checks are
best-effort UX. Two concurrent registers can race past them; the
UNIQUE / PRIMARY KEY constraints on the `workspaces` table are the
deterministic backstop. A racing INSERT that trips a constraint
surfaces as `DatabaseUnavailable`, not `WorkspacePathConflict`.

## Workspace root directory

`LocalWorkspaceProvisioner` ensures the workspace root directory exists
at registration so a bad path fails fast. The per-domain subdirs
(`sessions/`, `tasks/`, `workflows/`) are created lazily by the session,
task, and workflow packages, which own everything beneath them.

`globalDbPath()` and `workspacesParentDir()` live in
`@glyphs-ai/server` (`packages/server/src/glyph-home.ts`).

## Testing

```sh
pnpm --filter @glyphs-ai/workspace test
```

Repository and read-query tests open `openWorkspaceDb({ url: ":memory:" })`
(via `test/support/open-test-workspace-db.ts`) so the schema goes through the
real migrator; each `:memory:` connection is its own isolated db needing no
file cleanup. Read use-case tests drive the real `DrizzleWorkspaceQueries`
against that in-memory DB, while write use-case tests mock the repository.
Vitest runs in `forks` pool (native SQLite bindings can segfault on
worker-thread teardown on Windows).
