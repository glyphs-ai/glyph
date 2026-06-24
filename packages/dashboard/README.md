# @glyphs-ai/dashboard

The glyph dashboard SPA — React + Vite + react-router. The bundled
production build is served by `@glyphs-ai/server` on the same port Vite
hosts the dev UI on (8787), so dashboard URLs / muscle memory don't shift
between dev and prod. That 8787 is Vite's own port in dev; the glyph
backend runs separately on `:41817` and Vite proxies `/api/*` to it.

## Modes

| script | use case | backend |
|---|---|---|
| `pnpm -F @glyphs-ai/dashboard dev` | normal dev | real glyph server on `:41817` |
| `pnpm -F @glyphs-ai/dashboard dev:mock` | UI iteration without backend | MSW + in-bundle fixtures on `:8788` |
| `pnpm -F @glyphs-ai/dashboard dev:mock:e2e` | dedicated Playwright loop for `official/designer` | MSW on `:5180` |
| `pnpm -F @glyphs-ai/dashboard build` | static `dist/` (consumed by `pnpm bundle`) | n/a |
| `pnpm -F @glyphs-ai/dashboard test` | vitest suite | n/a |

## Designer mode

`dev:mock` serves the dashboard against [Mock Service Worker](https://mswjs.io/)
handlers seeded from hand-authored fixtures in `src/mocks/fixtures/`.
Use this when iterating on layout, styling, or component behaviour
without needing a real glyph server up.

Fixture coverage today (read-only):

- **Tasks**: running / succeeded / failed / cancelled × 0 / 1 / N
  artifacts × html / image / markdown / text / json. Includes a
  `schedule`-origin task carrying `metadata.scheduleId` for the
  scheduled-tasks route.
- **Sessions, agents, workspaces**: 2–3 fixtures each.
- **Activity timelines**: hand-authored for the long-running task plus
  two terminal ones so the activity tab has user / assistant /
  thinking / tool_call / system / summary kinds to render.

Mocked mutations are intentionally narrow: schedules can be created,
edited, run, and deleted, and workflows can be created or cancelled
against the in-memory fixtures. All other POST/PATCH/DELETE routes
return 501 so unimplemented surfaces stay visible.

To add a fixture, edit the relevant file under `src/mocks/fixtures/`,
add a handler in `src/mocks/handlers.ts` if you need a new route, and
restart `dev:mock`. See `src/mocks/README.md` for the file layout +
the prod-bundle exclusion guarantee.

### Ports

- `8787` — `dev`, the port Vite serves the dashboard UI on. It is the
  prod-bundled server's port re-used in dev (so URLs don't shift between
  dev and prod), not the backend's: Vite proxies `/api/*` from here to
  the glyph server on `:41817`.
- `41817` — the glyph backend that `dev` proxies `/api/*` to, set by
  `cross-env PORT=41817` in `packages/server`'s `dev` script. Keep it in
  lock-step with the proxy target in `vite.config.ts`, or dev `/api`
  calls ECONNREFUSED.
- `8788` — `dev:mock` (deliberately `dev port + 1` so the collision is
  obvious; `--strictPort` makes collisions fail loudly instead of
  silently re-binding).
- `5180` — `dev:mock:e2e`, dedicated to the future `official/designer`
  agent's Playwright dispatch loop.

### Regenerating the service worker

`public/mockServiceWorker.js` is committed verbatim — regenerate it
after upgrading the `msw` package:

```bash
pnpm -F @glyphs-ai/dashboard exec msw init public/ --save
```
