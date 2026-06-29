# @glyphs-ai/workspace

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

A *workspace* is a user-chosen directory that holds glyph's
per-project state. This package manages the global registry: a single
`$GLYPH_HOME/global.db` SQLite table mapping opaque UUIDs to absolute
paths, plus allocation/cleanup of the per-workspace `sessions/`,
`tasks/`, and `workflows/` parent directories. Sibling packages own
the contents beneath those directories and the per-workspace
`workspace.db`. The directory is normally user-chosen but can also be
auto-allocated under `$GLYPH_HOME/workspaces/<uuid>/` when the caller
doesn't specify one. The global registry stores each workspace's
display name + last-opened timestamp; there is no per-workspace
metadata sidecar file.

## Layout

```
packages/workspace/src/
  domain/
    workspace.entity.ts        WorkspaceEntity (pkg-owned domain shape)
    workspace-id.ts            WorkspaceId schema + branded type
    workspace-name.ts          WorkspaceName schema + branded type
    workspace-repository.ts    repository port + repository error atoms
    workspace-provisioner.ts   filesystem provisioner port + error atom
  application/
    *.ts                       one use-case class per operation
    workspace-public.ts        curated domain/error surface exported by index.ts
  infrastructure/drizzle/
    workspace-schema.ts        Drizzle table def (private; only types exported)
    workspace-db.ts            openDb() factory + Db handle type
    workspace-migrations.ts    applyWorkspaceMigrations
    workspace-repository.ts    Drizzle repository adapter
  infrastructure/file/
    local-workspace-provisioner.ts  creates/removes sessions/, tasks/, workflows/
  workspace-module.ts          composeWorkspaceModule({ dbFile, defaultWorkspaceParent, logger? })
  index.ts                     public barrel (compose + use-case contracts + curated domain types)
drizzle/                       generated SQL migrations (committed)
drizzle.config.ts              drizzle-kit config
```

## Public API

The `.` entrypoint exports the composition surface, per-use-case wire
contracts, the curated cross-use-case domain/error surface, and
`UseCase` / `UseCaseResult`:

```ts
import { composeWorkspaceModule } from "@glyphs-ai/workspace";

const workspace = await composeWorkspaceModule({
  dbFile: "/abs/path/to/global.db",
  defaultWorkspaceParent: "/abs/path/to/$GLYPH_HOME/workspaces",
});

// Reads
await workspace.listWorkspaces.execute({});                  // Result<Workspace[], E>
await workspace.getWorkspace.execute({ id });                // Result<Workspace | null, E>
await workspace.getLastOpenedWorkspace.execute({});          // Result<Workspace | null, E>
await workspace.getLastOpenedWorkspaceId.execute({});        // Result<string | null, E>

// Writes
await workspace.registerWorkspace.execute({ name, workspaceDir }); // workspaceDir optional
await workspace.openWorkspace.execute({ id });
await workspace.renameWorkspace.execute({ id, name });
await workspace.unregisterWorkspace.execute({ id, purge: false });

await workspace.close();                                  // closes the SQLite handle
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
├── WorkspaceNotRegistered    id has no entry in the registry
├── WorkspaceIdConflict       workspace id primary-key collision
├── WorkspacePathConflict     workspaceDir already registered
├── DatabaseUnavailable       registry-level storage failure
└── ProvisioningFailed        filesystem skeleton create/remove failure
```

These are **precondition / conflict / infrastructure** errors. Input
*format* validation (id grammar, name rules, absolute-path) is not a
typed error: use-cases parse inputs with their Zod schemas, so a
malformed id / name / workspaceDir raises a `ZodError`, which the api
layer maps to a 400 `ValidationError` envelope.

Workspace precondition and infrastructure failures are
discriminated-union values returned in the use-case `Err` channel.
`getWorkspace.execute({ id })` raises a `ZodError` for a malformed id
and returns `Ok(null)` only for a valid-but-unknown id.

Concurrency: `registerWorkspace`'s pre-flight conflict checks are
best-effort UX. Two concurrent registers can race past them; the
UNIQUE / PRIMARY KEY constraints on the `workspaces` table are the
deterministic backstop, and the insert is wrapped to translate SQLite
constraint errors back into typed domain errors.

## Workspace skeleton

`LocalWorkspaceProvisioner` creates and removes the workspace skeleton:
`sessions/`, `tasks/`, and `workflows/`. Workspace owns these parent
directories; the session, task, and workflow packages own entries
beneath them.

`globalDbPath()` and `workspacesParentDir()` live in
`@glyphs-ai/server` (`packages/server/src/glyph-home.ts`).

## Testing

```sh
pnpm --filter @glyphs-ai/workspace test
```

Repository tests open `dbFile: ":memory:"` via `openDb` so the schema
goes through the real migrator; use-case tests mock the repository.
Vitest runs in `forks` pool (better-sqlite3's native binding segfaults
on worker-thread teardown on Windows).
