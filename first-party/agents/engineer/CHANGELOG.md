# Changelog

## 0.2.2 (2026-07-06)

- Correct the **wire schema** guidance, tier diagram, and package-layout listing: there is no `packages/api/src/wire/` surface. HTTP request / response zod schemas are owned by the domain packages (`application/<use-case>.ts`); `@glyphs-ai/api` composes them into `OpenAPIHono` route factories under `packages/api/src/routes/<domain>.ts`; `@glyphs-ai/server` mounts the factories; `@glyphs-ai/sdk` is generated from the resulting OpenAPI spec and is what `dashboard` / `cli` import.

## 0.2.1 (2026-06-26)

- Repoint the **Wire DTOs** guidance, tier diagram, and package-layout listing off the deleted `@glyphs-ai/contracts` package: T2 is now `api` (orchestration + wire DTOs under `src/wire/`) + `sdk` (generated client). New HTTP-route request / response types live in `packages/api/src/wire/` (declared via `packages/api/src/wire/routes/<domain>.ts`); `dashboard` / `cli` import wire types from `@glyphs-ai/sdk`.

## 0.2.0 (2026-06-12)

- Add **Comment hygiene** section: forbid transient PM labels (PR numbers, issue numbers, iter-N, version tags, mission IDs) in code comments; forbid speculative TODOs; forbid archaeological "this used to be Y" comments.
- Add **PowerShell encoding caveat** to the Git workflow section: always use `gh ... --body-file <utf8-file>` on Windows; argument-string encoding mangles em-dashes / arrows / section signs.
- Add **Private-package versioning is cosmetic** rule under Boundaries: `private: true` packages don't get version bumps or per-package CHANGELOGs; semver discipline applies to first-party agents / skills / MCPs only.

## 0.1.0 (2026-06-11)

- Initial release.
