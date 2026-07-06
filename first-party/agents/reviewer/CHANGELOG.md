# Changelog

## 0.2.2 (2026-07-06)

- Correct the **Wire DTOs** project-knowledge line: there is no `packages/api/src/wire/` surface. HTTP request / response zod schemas are owned by the domain packages (`application/<use-case>.ts`) and composed into `OpenAPIHono` route factories under `packages/api/src/routes/`; `@glyphs-ai/sdk` is generated from the OpenAPI spec and is what `dashboard` / `cli` import.

## 0.2.1 (2026-06-26)

- Repoint **Project knowledge** and the consistency-review criterion off the deleted `@glyphs-ai/contracts` package: tier layering T2 is now `api` + `sdk`, wire DTOs live in `packages/api/src/wire/`, and the fenced surfaces (`dashboard` / `cli`) import wire types from `@glyphs-ai/sdk`.

## 0.2.0 (2026-06-12)

- Add **MODE selection** at the top of the prompt: `MODE: code` (default — analyse PR diff, produce verdict + inline comments) or `MODE: ci` (block on `gh pr checks --watch`, produce a verdict capturing pass/fail per CI job, no diff reading, no inline comments). Default-to-`code` keeps pre-MODE briefs producing identical reviews.
- Add detailed **MODE: ci** section: workflow (read `${PR_NUMBER}`, `gh pr checks --watch` with 30-min timeout, capture per-job state, embed ≤2 KB failed-job log tail), output location `<workdir>/artifact/verdict.json`, and explicit non-responsibilities (no diff, no inline comments, no merge decisions, no auto-retry).
- Add **Comment durability** criterion to the review rubric: flag transient PM labels (PR numbers, issue numbers, iter-N, version tags, mission IDs), comments that restate what the code says, and archaeological "used to be Y" comments. Categorise as suggestion unless misleading.
- Add **PowerShell encoding caveat** near the `gh` commands table: always use `--body-file <utf8-file>` on Windows; argument-string encoding mangles em-dashes / arrows / section signs.

## 0.1.0 (2026-06-11)

- Initial release.
