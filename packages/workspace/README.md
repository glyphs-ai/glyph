# @glyphs-ai/workspace

A *workspace* is a user-chosen directory that holds glyph's
per-project state. This package manages only the registry side: a
single `$GLYPH_HOME/global.db` SQLite table mapping opaque UUIDs to
absolute paths, plus allocation/cleanup of the per-workspace
`sessions/` and `tasks/` subdirectories. It does not allocate
`workflows/`; workflow is a T1 concern owned by
`@glyphs-ai/workflow`. The per-workspace `workspace.db` file is
created and populated by sibling packages (`@glyphs-ai/session`,
`@glyphs-ai/task`, `@glyphs-ai/catalog`). The directory is normally
user-chosen but can also be auto-allocated under
`$GLYPH_HOME/workspaces/<uuid>/` when the caller doesn't specify one.
The global registry stores each workspace's display name + last-opened
timestamp; there is no per-workspace metadata sidecar file.

## Layout

```
packages/workspace/src/
  schema.ts                  Drizzle table def (private; only types exported)
  errors.ts                  Domain error classes (exported)
  types.ts                   Public DTOs (Workspace) (exported)
  validate.ts                Input schemas + assertValid* helpers
  workspace-repository.ts    Drizzle CRUD (private; never exported)
  workspace-entity.ts        WorkspaceEntity (private; service projects to DTO)
  workspace-service.ts       WorkspaceService — register/open/rename/unregister + reads
  layout.ts                  Pure path helpers (workspaceLayout, globalDbPath, ...)
  migrations.ts              applyWorkspaceMigrations (drizzle migration applier)
  compose.ts                 composeWorkspaceModule({ dbFile, logger? })
  index.ts                   public barrel
drizzle/                     generated SQL migrations (committed)
drizzle.config.ts            drizzle-kit config
```

## Public API

```ts
import { composeWorkspaceModule, WorkspaceService } from "@glyphs-ai/workspace";

const { service, close } = await composeWorkspaceModule({
  dbFile: "/abs/path/to/global.db",
});

// Reads
await service.list();                           // Workspace[]
await service.get(id);                          // Workspace | null
await service.getLastOpened();                  // Workspace | null
await service.getLastOpenedId();                // string | null

// Writes
await service.register({ id, workspaceDir, name });
await service.open(id);
await service.rename(id, { newName });
await service.unregister(id, { purge: false });

await close();                                  // closes the SQLite handle
```

The service owns reads + writes. There is no separate `Queries`
class. The repository is package-private — consumers go through the
service.

`list()` returns workspaces ordered by `lastOpenedAt DESC`, with ties
broken by `createdAt DESC` then `id ASC` (so identical-ms timestamps
resolve to the lowest UUID).

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
`getLastOpened` returns; it's the registry's "current" workspace from
the user's POV. `register` sets `last_opened_at = now` (registration
is implicit first-open); `open(id)` updates it on subsequent opens.
`ORDER BY last_opened_at DESC` pushes never-opened rows last
(SQLite's default NULL-sort under DESC).

Per-workspace metadata (`name`, `createdAt`) lives in the same
`workspaces` row — there is no `<workspace>/workspace.json` sidecar.

## Errors

```
WorkspaceError
├── InputValidationError               400 — register() opts failed the zod schema
├── WorkspaceNameInvalidError          400 — name failed validation
└── RegistryError                      500 — registry-level failure (base)
    ├── WorkspaceIdInvalidError        400 — id is not a valid UUID
    ├── WorkspacePathInvalidError      400 — workspaceDir empty / relative / non-string
    ├── WorkspaceNotRegisteredError    404 — id has no entry in the registry
    ├── WorkspaceIdConflictError       409 — register({id}) collision
    └── WorkspacePathConflictError     409 — workspaceDir already registered
```

A single `catch (e) { if (e instanceof WorkspaceError) … }` block
catches all workspace-package failures, including input-validation
errors from the zod shape check.

`get(id)` throws `WorkspaceIdInvalidError` for malformed ids and
returns `null` only for valid-but-unknown ids. All methods validate
their id parameter consistently.

Concurrency: `register`'s pre-flight conflict checks are best-effort
UX. Two concurrent registers can race past them; the UNIQUE / PRIMARY
KEY constraints on the `workspaces` table are the deterministic
backstop, and the insert is wrapped to translate SQLite constraint
errors back into typed domain errors.

## Layout helper

`workspaceLayout()` returns `sessions/`, `tasks/`, and `workflows`.
This T0 package actively manages only `sessions/` and `tasks/`:
`register` creates them and `unregister({ purge: true })` removes
them. The `workflows` path belongs to the T1 `@glyphs-ai/workflow`
package.

```ts
import { workspaceLayout, globalDbPath, workspacesParentDir } from "@glyphs-ai/workspace";

workspaceLayout("/abs/workspace-dir");
// {
//   sessions: "/abs/workspace-dir/sessions",
//   tasks:     "/abs/workspace-dir/tasks",
//   workflows: "/abs/workspace-dir/workflows", // T1 workflow owns this directory
// }

globalDbPath("/abs/home");        // "/abs/home/global.db"
workspacesParentDir("/abs/home"); // "/abs/home/workspaces"
```

All pure functions; no fs side effects. `workspaceLayout` is used by
this package's `WorkspaceService` for the `sessions/` and `tasks/`
filesystem work in `register` and `unregister({ purge: true })`. T1
workflow code owns `workflows/` through its own `workflowRoot()` helper.
`globalDbPath` and `workspacesParentDir` are consumed by
`@glyphs-ai/server` to locate the global DB and the auto-allocation
parent for new workspaces.

## Testing

```sh
pnpm --filter @glyphs-ai/workspace test
```

Tests run against `dbFile: ":memory:"` opened via the same
`composeWorkspaceModule` so the schema goes through the real
migrator. Vitest runs in `forks` pool (better-sqlite3's native
binding segfaults on worker-thread teardown on Windows).
