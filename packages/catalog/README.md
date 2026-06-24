# @glyphs-ai/catalog

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

Skill + MCP + Agent registry with dependency-aware resolve / install /
sync / update / uninstall. This is a T0 foundation package; `api`
composes it into per-workspace application services. SQLite-backed; the
per-workspace `workspace.db` owns `agents`, `skills`, `mcps`, the
`*_files` BLOB tables, and the dependency edge tables.

## Scope

What this package **does**:

- Read `AGENTS.md` / `SKILL.md` frontmatter and project the catalog
  fields: required `name` / `description` / `version`, optional `scope`
  (defaults to `public`), optional `prereqs`, and optional
  `dependencies`. Skills accept `dependencies.{skills,mcps}`; agents
  also accept `dependencies.agents`. Other frontmatter fields (such as
  `license`) are preserved on disk but **not interpreted**.
- Track MCP server specs (`<namespace>/<short>` FQN, e.g. `azure/mcp`).
  The JSON spec body is stored verbatim in `workspace.db` as text and is
  parsed only for catalog-owned `_meta` handling.
- Resolve transitive dependency closures (topological sort) for any
  skill or agent.
- Parse and fetch install origins via local `file:` paths, GitHub tree
  URLs, or Azure DevOps Services item URLs.
- Validate graph rules on writes: name uniqueness, kebab-case,
  missing-dependency, no cycles, reverse-dependency safety on
  uninstall. The catalog schema has no FK constraints, so each
  `SkillRepository.delete` / `McpRepository.delete` runs an
  in-transaction `count()` check over the typed dep edge tables and
  throws `HasDependentsError` directly (rolling back the empty
  delete).

What this package **does not** do:

- Interpret business fields (`prereqs`, semantic version checks,
  signature verification, etc.). That belongs in install tools
  layered on top.
- Interpret MCP server runtime configuration beyond catalog-owned
  `_meta` fields. Runtime adapters consume stripped MCP config bytes when
  they spawn servers.
- Execute installed entries, copy or "ingest" skills into agents, spawn
  MCP servers, or materialise runtime workdirs. Runtime adapters consume
  catalog streams and MCP config bytes through the service API.

## Exports

- `@glyphs-ai/catalog` — public DTOs, entity classes, per-entity service
  namespaces, fetcher helpers, validators, errors, and
  `composeCatalogModule`.
- `@glyphs-ai/catalog/testing` — `openTestCatalogDb` for in-memory
  better-sqlite3 tests.

## Layout

```
packages/catalog/src/
  schema.ts                Drizzle tables (private; only types exported)
  types.ts                 Cross-entity DTOs (Agent / Skill / Mcp + entries + resolve results)
  validate.ts              FQN / name / install-body validators
  agent/                   Per-entity service + errors + entity class
  skill/
  mcp/
  facade/
    catalog-service.ts     Unified read+write surface across all entities
    resolve-pipeline.ts    Three-phase resolve: upstream closure → local closure → diff
    projection.ts          Pure projection helpers (Row → DTO)
    plan-types.ts          Shared cross-entity plan DTOs
    errors.ts              Cross-entity facade errors (HasDependentsError)
    index.ts               Facade barrel
  fetcher/                 Origin parser + remote bytes fetcher
  _shared/                 Package-private utilities (dep-keys, etc.)
  migrations.ts            applyCatalogMigrations (drizzle migration applier)
  compose.ts               composeCatalogModule({ dbFile, logger? })
  testing.ts               openTestCatalogDb helper (via /testing subpath)
  index.ts                 public barrel
drizzle/                   generated SQL migrations (committed)
drizzle.config.ts          drizzle-kit config
```

## On-disk

Everything lives inside the per-workspace shared `workspace.db`:
`agents`, `skills`, `mcps`, the `*_files` BLOB tables (agent +
skill content), and the per-entity dep edge tables. There is no
`<workspace>/catalog/` directory and no per-entity files on disk;
agent and skill source content (frontmatter + Markdown body) is
read out of the BLOB columns.

> Why SQLite for catalog? See
> [docs/architecture.md — Backend selection](../../docs/architecture.md#backend-selection-when-sqlite)
> — catalog has cross-entity dependency-graph queries (`resolveAgent`)
> and BLOB content streams, which are exactly the cases the rule says
> SQLite owns.

## Quick start

```ts
import { composeCatalogModule } from "@glyphs-ai/catalog";

const { service: catalog, close } = await composeCatalogModule({
  dbFile: "/abs/path/to/workspace.db",
});

// Install (origin-driven). The resolver fetches the entry + its
// transitive deps, surfaces conflicts, and returns a CatalogPlan;
// install() walks the topology in order.
await catalog.installSkill("file:/abs/path/sop-prepared");
await catalog.installAgent("https://github.com/org/repo/tree/main/agents/code-reviewer");
await catalog.installMcpFromOrigin("file:/abs/path/mcps/playwright.json");

// Resolve from the local catalog (no network — DAG walk over
// already-installed entries; used by the runtime when materialising
// a workdir).
const plan = await catalog.resolveAgent("public/code-reviewer");

// Read DTOs at the boundary.
await catalog.listSkillEntries();        // SkillEntry[]
await catalog.getSkill(fqn);             // Skill | null
await catalog.listAgentEntries();
await catalog.listMcps();

await close();
```

## Errors

- `AgentFrontmatterError` / `SkillFrontmatterError` — malformed YAML
- `*NameInvalidError` — fails kebab-case / length / charset
- `*NotFoundError` — unknown FQN
- `*OriginConflictError` — install collision
- `CyclicDependencyError` — `resolveAgent` walk found a cycle
- `HasDependentsError` — uninstall blocked by reverse-deps; raised
  inside `SkillRepository.delete` / `McpRepository.delete` from the
  same transaction that counts dependents
- `McpInvalidJsonError` — MCP file failed JSON schema check
- `FetchError` / `OriginParseError` — fetcher subpackage errors

## Testing

```sh
pnpm --filter @glyphs-ai/catalog test
```

Vitest runs in `forks` pool (better-sqlite3's native binding
segfaults on worker-thread teardown on Windows).

## License

MIT