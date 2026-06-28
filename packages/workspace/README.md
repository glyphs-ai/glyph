# @glyphs-ai/workspace

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

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
  persistence/
    tables.ts                  Drizzle table def (private; only types exported)
    workspace.db.ts            openDb() factory + Db handle type
    migrations.ts              applyWorkspaceMigrations (drizzle migration applier)
    workspace.layout.ts        buildWorkspaceLayout() — conventional sub-path layout
    workspace.repository.ts    Drizzle CRUD (private; never exported)
  domain/
    workspace.entity.ts        WorkspaceEntity (pkg-owned domain shape; private)
  application/
    workspace.service.ts       WorkspaceService + projectWorkspace (Entity → wire DTO)
  contract/
    workspace.errors.ts        Public error classes (exported via ./contract)
    workspace.schemas.ts       Zod wire schemas + reusable scalar schemas
    workspace.types.ts         Inferred wire DTO + request/response types
    index.ts                   Public ./contract barrel
  workspace.compose.ts         composeWorkspaceModule({ dbFile, defaultWorkspaceParent, logger? })
  index.ts                     Public . barrel (service + compose only)
drizzle/                       generated SQL migrations (committed)
drizzle.config.ts              drizzle-kit config
```

## Public API

The `.` entrypoint exports only the service class and the composition surface:

```ts
import { composeWorkspaceModule, type WorkspaceService } from "@glyphs-ai/workspace";

const { service, close } = await composeWorkspaceModule({
  dbFile: "/abs/path/to/global.db",
  defaultWorkspaceParent: "/abs/path/to/$GLYPH_HOME/workspaces",
});

// Reads
await service.list();                           // Workspace[]
await service.get(id);                          // Workspace | null
await service.getLastOpened();                  // Workspace | null
await service.getLastOpenedId();                // string | null

// Writes
await service.register({ name, workspaceDir });  // workspaceDir optional; the id is minted
await service.open(id);
await service.rename(id, { name });
await service.unregister(id, { purge: false });

await close();                                  // closes the SQLite handle
```

Errors, DTOs, and wire schemas are reached via the `./contract` subpath:

```ts
import {
  WorkspaceError,
  WorkspaceNotRegisteredError,
  type Workspace,
  type RegisterWorkspaceRequest,
  WorkspaceSchema,
  WorkspaceIdSchema,
  WorkspaceNameSchema,
} from "@glyphs-ai/workspace/contract";
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

All error classes live in `contract/workspace.errors.ts` and are exported via
the `./contract` subpath:

```
WorkspaceError                          (base — `instanceof` catch-all)
└── RegistryError                      500 — registry-level failure (base)
    ├── WorkspaceNotRegisteredError    404 — id has no entry in the registry
    ├── WorkspaceIdConflictError       409 — workspace id (primary key) collision
    └── WorkspacePathConflictError     409 — workspaceDir already registered
```

These are **precondition / conflict** errors. Input *format* validation
(id grammar, name rules, absolute-path) is NOT a typed error: the
service parses its inputs with the zod schemas in `contract/workspace.schemas.ts`,
so a malformed id / name / workspaceDir raises a `ZodError`, which the
api layer maps to a 400 `ValidationError` envelope.

A single `catch (e) { if (e instanceof WorkspaceError) … }` block
catches all workspace-package precondition failures. `get(id)` raises a
`ZodError` for a malformed id and returns `null` only for a
valid-but-unknown id.

Concurrency: `register`'s pre-flight conflict checks are best-effort
UX. Two concurrent registers can race past them; the UNIQUE / PRIMARY
KEY constraints on the `workspaces` table are the deterministic
backstop, and the insert is wrapped to translate SQLite constraint
errors back into typed domain errors.

## Layout helper

`buildWorkspaceLayout()` (in `persistence/workspace.layout.ts`, internal to the package) returns `sessions/`,
`tasks/`, and `workflows/`. This T0 package actively manages only
`sessions/` and `tasks/`: `register` creates them and
`unregister({ purge: true })` removes them. The `workflows` path
belongs to the T1 `@glyphs-ai/workflow` package.

`globalDbPath()` and `workspacesParentDir()` live in
`@glyphs-ai/server` (`packages/server/src/glyph-home.ts`).

## Testing

```sh
pnpm --filter @glyphs-ai/workspace test
```

Repository tests open `dbFile: ":memory:"` via `openDb` so the schema
goes through the real migrator; service tests mock the repository.
Vitest runs in `forks` pool (better-sqlite3's native binding segfaults
on worker-thread teardown on Windows).
