# @glyphs-ai/catalog

> **Tier:** T0 (Foundations).

Skill + MCP + Agent registry with dependency-aware resolve / install /
uninstall. This is a T0 foundation package; `api`
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
- Validate graph rules on writes: name uniqueness, kebab-case, and
  dependency-aware install planning. Use-cases return
  discriminated-union errors through `neverthrow` results; they do not
  throw catalog error classes.

What this package **does not** do:

- Interpret business fields (`prereqs`, semantic version checks,
  signature verification, etc.). That belongs in install tools
  layered on top.
- Interpret MCP server runtime configuration beyond catalog-owned
  `_meta` fields. Runtime adapters consume stripped MCP config bytes when
  they spawn servers.
- Execute installed entries, copy or "ingest" skills into agents, spawn
  MCP servers, or materialise runtime workdirs. Runtime adapters consume
  catalog streams and MCP config bytes through structural ports assembled
  by the API composition root.

## Exports

- `@glyphs-ai/catalog` — `composeCatalog({ dbFile })`, the `CatalogModule`
  use-case container, per-use-case request / response / error contracts,
  the curated domain surface, resolution graph types, and plan / apply
  DTOs. Implementation details are package-internal.

## Layout

```
packages/catalog/src/
  index.ts                 public barrel (compose + contracts + curated domain types)
  catalog-module.ts        composeCatalog({ dbFile }) -> CatalogModule
  domain/                  entities, manifests, branded FQNs, repository/source ports
    agent-entity.ts        AgentEntity (skill / mcp mirror)
    agent-manifest.ts      frontmatter parsing (skill / mcp mirror)
  application/             one use-case class per verb
    resolve-plan.ts          fetch upstream graph + diff against local state
    apply-plan.ts            apply a resolved plan through install use-cases
    resolve-agent.ts         local DAG projection for runtime materialisation
  infrastructure/drizzle/   persistence adapter (sole DB syscall site)
    catalog-schema.ts        Drizzle tables (private; only types exported)
    catalog-migrations.ts    applyCatalogMigrations
    catalog-db.ts            openDb(dbFile): prod + test factory
    agent-repository.ts      per-entity repository (skill / mcp mirror)
  infrastructure/source/    outbound content adapter (origin → bytes): File / GitHub / ADO
drizzle/                   generated SQL migrations (committed)
drizzle.config.ts          drizzle-kit config (→ src/infrastructure/drizzle/catalog-schema.ts)
```

## On-disk

Everything lives inside the per-workspace shared `workspace.db`:
`agents`, `skills`, `mcps`, the `*_files` BLOB tables (agent +
skill content), and the per-entity dep edge tables. There is no
`<workspace>/catalog/` directory and no per-entity files on disk;
agent and skill source content (frontmatter + Markdown body) is
read out of the BLOB columns.

> Why SQLite for catalog? Catalog has cross-entity dependency-graph
> queries (`resolveAgent`) and BLOB content streams — exactly the cases
> SQLite owns.

## Quick start

```ts
import { composeCatalog } from "@glyphs-ai/catalog";

const catalog = composeCatalog({
  dbFile: "/abs/path/to/workspace.db",
});

// Install (origin-driven). The resolver fetches the entry + its
// transitive deps, surfaces conflicts, and returns a CatalogPlan;
// applyPlan walks the topology in order.
const plan = await catalog.resolvePlan.execute({
  kind: "agent",
  origin: "https://github.com/org/repo/tree/main/agents/code-reviewer",
});
if (plan.isErr()) throw new Error(plan.error.type);
await catalog.applyPlan.execute({ plan: plan.value });

// Resolve from the local catalog (no network — DAG walk over
// already-installed entries; used by the runtime when materialising
// a workdir).
const resolved = await catalog.resolveAgent.execute({ id: "public/code-reviewer" });

// Read DTOs at the boundary.
await catalog.listSkillEntries.execute({}); // Result<SkillEntry[], E>
await catalog.getSkill.execute({ id: fqn }); // Result<Skill, SkillNotFound | E>
await catalog.listAgentEntries.execute({});
await catalog.listMcps.execute({});

await catalog.close();
```

## Errors

Catalog use-cases return discriminated-union error objects through
`Result`, for example:

- `SkillNotFound` / `AgentNotFound` / `McpNotFound` — unknown FQN
- `SkillOriginConflict` / `AgentOriginConflict` / `McpOriginConflict` — install collision
- `OriginInvalid` / `ManifestInvalid` / `SourceUnavailable` — origin fetch or parse failure
- `DatabaseUnavailable` — persistence failure

## Testing

```sh
pnpm --filter @glyphs-ai/catalog test
```

Vitest runs in `forks` pool (better-sqlite3's native binding
segfaults on worker-thread teardown on Windows).

## License

MIT