# @glyphs-ai/__PKG__

> **Tier:** chosen per package. `_template` is the scaffold that `pnpm new-pkg` copies; pick the new package's tier from the [tier model](../../docs/architecture.md#tier-model).

TODO: replace this with a short description of what the __PKG__ package owns.

## Layout

A single-aggregate package with a rich domain model, write-side repository, and
read-side query seam:

    src/
      domain/                          # pure aggregate, value objects, repository port
        __entity-kebab__-entity.ts         # entity: two-door (new / create); transitions return Result
        __entity-kebab__-id.ts             # branded id value object (zod)
        __entity-kebab__-name.ts           # branded name value object (per-property validation)
        __entity-kebab__-repository.ts     # write-side repository PORT + error atoms
      application/                     # use-cases; each owns its Request/Response/Error
        use-case.ts                        # UseCase<Req,Res,Err>; UseCaseResult = ResultAsync
        create-__entity-kebab__.ts         # write use-case; repo.save
        get-__entity-kebab__.ts            # read use-case; query seam, nullable response
        archive-__entity-kebab__.ts        # write use-case; load-mutate-save
        list-__entity-kebab__s.ts          # read use-case; query seam
        __entity-kebab__-public.ts         # named public domain/error re-exports
      infrastructure/drizzle/          # adapters implementing ports/seams
        __entity-kebab__-schema.ts         # drizzle table
        __entity-kebab__-db.ts             # openDb -> { db, close }
        __entity-kebab__-migrations.ts     # AUTO-GENERATED from drizzle/*.sql (never hand-edit)
        __entity-kebab__-mapper.ts         # row <-> entity mapper
        __entity-kebab__-repository.ts     # write-side Drizzle adapter
        __entity-kebab__-queries.ts        # read-side Drizzle query seam
      __entity-kebab__-module.ts       # composition root: compose__Entity__Module({ dbFile })
      index.ts                         # named public surface; no export *
    test/                              # mirrors src/ 1:1; test data is inlined (no fixtures/helpers)

## Conventions

- **Errors are discriminated unions** (`{ type: "..." }`) flowing through
  neverthrow `Result`. Only infrastructure adapters convert driver failures
  into `DatabaseUnavailable`; domain and application never throw for control
  flow.
- **Each use-case owns its contract.** Every file exports its own
  `RequestSchema` / `ResponseSchema` (zod; the TS type is `z.infer`) and `Error`
  union. Use-cases do not share DTOs.
- **Write-side repository triad:** repositories expose only `get`, `save`, and
  `delete`. Flexible read use-cases use `infrastructure/drizzle/*-queries.ts`
  and return row projections instead of domain entities.
- **The entity owns its state.** Mutators live on the entity and return `Result`
  when they can fail (`archive`); the application layer never writes fields
  directly.
- **Value objects validate every property.** Each attribute is a branded zod
  value object in `domain/` (`__entity-kebab__-id.ts`, `__entity-kebab__-name.ts`),
  so validity is owned by the domain and reused wherever the value is accepted
  (request bodies included) — the entity only ever holds validated values.
- **Defense in depth:** `execute` parses its request through the schema on
  entry, so malformed wire input throws `ZodError` (mapped to 400 at the HTTP
  boundary).

Monorepo-wide conventions live in
[`docs/pkg-template.md`](../../docs/pkg-template.md).

## After scaffolding

`pnpm new-pkg <pkg-name> <EntityName> <table_name>` substitutes the placeholder
tokens (`__PKG__`, `__Entity__`, `__entity__`, `__entities__`,
`__entity-kebab__`). Then:

1. `pnpm install`
2. `pnpm --filter @glyphs-ai/<pkg-name> db:generate` — regenerate `drizzle/*.sql`
   and the inlined migration from the schema.
3. `pnpm exec biome check --write packages/<pkg-name>` — normalize formatting and
   import order (substituting the placeholder tokens can shift line widths).
4. `pnpm --filter @glyphs-ai/<pkg-name> test`

Rename `list-__entity-kebab__s.ts` and its symbols if your entity's plural is
not `<entity>s`.
