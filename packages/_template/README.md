# @glyphs-ai/__PKG__

> **Tier:** chosen per package. `_template` is the scaffold that `pnpm new-pkg` copies; pick the new package's tier from the [tier model](../../docs/architecture.md#tier-model).

TODO: replace this with a short description of what the __PKG__ package owns.

## Layout

A single-aggregate service package. Imports flow downward only:
`application → domain` and `infrastructure → domain`; nothing depends on
`infrastructure`.

    src/
      domain/                          # pure aggregate, value objects, repository port
        __entity-kebab__-entity.ts         # entity: two-door (new / create); transitions return Result
        __entity-kebab__-id.ts             # branded id value object (zod)
        __entity-kebab__-repository.ts     # repository PORT + error atoms
      application/                     # use-cases; depends only on domain
        use-case.ts                        # UseCase<Req,Res,Err>; UseCaseResult = Promise<Result>
        create-__entity-kebab__.ts         # one file per use-case; owns its Request/Response/Error
        get-__entity-kebab__.ts
        archive-__entity-kebab__.ts
        list-__entity-kebab__s.ts
        index.ts                           # curated barrel: shared value objects + error atoms
      infrastructure/drizzle/          # adapters implementing the domain port
        __entity-kebab__-schema.ts         # drizzle table
        __entity-kebab__-db.ts             # openDb -> { db, close }
        __entity-kebab__-migrations.ts     # AUTO-GENERATED from drizzle/*.sql (never hand-edit)
        __entity-kebab__-mapper.ts         # row <-> entity
        __entity-kebab__-repository.ts     # Drizzle adapter for the port
      __entity-kebab__-module.ts       # composition root: compose__Entity__Module({ dbFile })
      index.ts                         # public surface: wire contracts + barrel + compose
    test/                              # mirrors src/ 1:1; test data is inlined (no fixtures/helpers)

## Conventions

- **Errors are discriminated unions** (`{ type: "..." }`) flowing through
  neverthrow `Result`. Only infrastructure adapters `try/catch` and convert
  driver throws into `DatabaseUnavailable`; domain and application never throw
  for control flow.
- **Each use-case owns its contract.** Every file exports its own
  `RequestSchema` / `ResponseSchema` (zod; the TS type is `z.infer`) and `Error`
  union. Use-cases do not share DTOs.
- **Repository split:** `findById` returns `Entity | undefined` (absence is
  normal); `get` asserts existence and yields `__Entity__NotFound`. Port
  signatures inline their error union — no per-op alias.
- **The entity owns its state.** Mutators live on the entity and return `Result`
  when they can fail (`archive`); the application layer never writes fields
  directly.
- **Defense in depth:** `execute` parses its request through the schema on
  entry, so malformed wire input throws `ZodError` (mapped to 400 at the HTTP
  boundary).

Monorepo-wide conventions (tiers, file naming, where DTOs live, splitting an
oversized file into a facade + sibling subdir) live in
[`docs/pkg-template.md`](../../docs/pkg-template.md); the split-layout reference
is at [`packages/_template/_examples/split-layout/`](./_examples/split-layout/).

## After scaffolding

`pnpm new-pkg <pkg-name> <EntityName> <table_name>` substitutes the placeholder
tokens (`__PKG__`, `__Entity__`, `__entity__`, `__entities__`,
`__entity-kebab__`). Then:

1. `pnpm install`
2. `pnpm --filter @glyphs-ai/<pkg-name> db:generate` — regenerate `drizzle/*.sql`
   and the inlined migration from the schema.
3. `pnpm --filter @glyphs-ai/<pkg-name> test`

Rename `list-__entity-kebab__s.ts` and its symbols if your entity's plural is
not `<entity>s`.
