# feat(#120): schema-ize the SSE activity stream + typed SDK/CLI/dashboard

Fixes #120.

## What

The task activity SSE endpoint (`GET /api/workspaces/{id}/tasks/{tid}/activity/stream`)
now has a **typed** OpenAPI `text/event-stream` response instead of an `errorResponse`
placeholder that generated `200: unknown`. hey-api codegen turns it into a typed,
one-shot SSE iterator, and every consumer (server → SDK → CLI → dashboard) is migrated
onto that generated operation. The server also emits `heartbeat` keep-alive frames and a
terminal `end` sentinel that are now part of the documented wire contract.

## Why

Before this change the stream carried `unknown` across the wire types, so the CLI hand-rolled
a raw `fetch()` + `parseSseFrame()` and the dashboard hand-rolled an `EventSource` — two
parallel, untyped SSE parsers. Schema-izing the response makes the stream a first-class,
typed part of the SDK, deletes both bespoke parsers, and lets intermediaries (and clients)
distinguish a live-but-quiet stream from a dead connection via heartbeats.

Investigation (committed separately as `research/phase7-sse-investigation.md`) settled the
format question: **OpenAPI 3.1 union over the raw SSE `data:` payloads**. OpenAPI 3.2
`itemSchema` is doubly blocked in our toolchain today — `@hono/zod-openapi` (via
`zod-to-openapi@8.5.0`) cannot emit a 3.2 document, and `@hey-api/openapi-ts@0.99.0`
ignores `itemSchema` and falls back to `unknown`. Both were verified by running the tools,
not by reading changelogs.

## Changes

**Wire contract (server)** — `packages/api/src/routes/tasks.ts`
- Added `ActivityStreamEventSchema = z.union([ActivityItemSchema, { error: string }, {}])`
  (renders as `anyOf`; no shared discriminator property so the raw `data:` bytes are
  unchanged). Consumers route on the SSE `event:` name (`activity` | `heartbeat` | `end` |
  `error`), which is the wire discriminator — `heartbeat` and `end` are both empty `{}`.
- Typed the `200` as `content: { "text/event-stream": { schema: ActivityStreamEventSchema } }`.
- Emit a 15s `heartbeat` frame (`HEARTBEAT_INTERVAL_MS`) while the activity iterator is idle;
  the interval is `unref`'d and cleared in `finally` (no leak, never fires after `end`).
- **Byte-compatible:** `activity` frames stay `event: activity\nid: <seq>\ndata: <JSON>\n\n`
  and the `end` sentinel stays `event: end\ndata: {}\n\n`.

**SDK (generated)** — `packages/sdk/src/generated/*`, `packages/sdk/package.json`
- Regenerated: the op now returns `Promise<ServerSentEventsResult<…>>` via `client.sse.get()`,
  and the `200` response type is the typed union (6 ActivityItem variants | `{ error }` | `{}`)
  instead of `unknown`. The SDK stays a **one-shot** iterator — reconnection is caller policy.
- `package.json` description notes typed SSE/streaming endpoints. Codegen is drift-clean and
  idempotent.

**CLI** — `packages/cli/src/commands/task.ts`, `sdk-client.ts`, `connect.ts`, test
- `followTaskActivity` rewritten over the generated SSE op; deleted the raw `fetch()` +
  `parseSseFrame()` and the "SSE out of scope" comment. Routes on the SSE `event:` name via
  `onSseEvent`; `sseMaxRetryAttempts: 1` makes it one-shot so a dropped stream surfaces a
  resume hint and the user re-runs (CLI does not auto-reconnect).
- Dropped the now-orphaned `SdkClient.baseUrl` plumbing (the configured client owns the base
  URL); `makeSdkClient`/`configureClient` are side-effect only.

**Dashboard** — `packages/dashboard/src/api/tasks.ts`, `hooks/useReconnectingStream.ts` (new),
`hooks/useTaskDetail.ts`, `mocks/handlers.ts`
- Replaced the `EventSource`-based `subscribeTaskActivity` with `openActivityStream()`, a
  one-shot SDK-backed connection that resolves on `end`/close/abort.
- New `useReconnectingStream` hook owns the reconnection policy the SDK deliberately omits:
  exponential backoff (1s→30s, reset on progress) with `Last-Event-ID` resume, stops on the
  `end` sentinel, and aborts cleanly on teardown. Wired into `useTaskDetail`.
- MSW handler now emits real `heartbeat` + `end` frames (was `204`).

**Tests**
- `packages/api/test/routes/tasks.test.ts`: new SSE block — activity frames stay
  byte-compatible, `end` sentinel closes the stream, `404 NoEventsYet` on null,
  `Last-Event-ID` → `after` resume (and non-numeric ignored), **heartbeat frames observable**
  (fake timers drive the handler's real `ReadableStream`), and a mid-stream throw surfaces an
  `event: error` frame instead of `end`.
- `packages/dashboard/test/hooks/useReconnectingStream.test.ts`: new — no-op when
  disabled/null, opens once + forwards items + stops on `end`, reconnects with `Last-Event-ID`
  after a non-`end` drop, aborts the in-flight connection on unmount.
- CLI `task-activity.test.ts` rewritten to mock the SDK op; server OpenAPI snapshot updated
  (the `200` is now the `anyOf` union).

## How to test

```sh
# From the repo root:
pnpm build && pnpm -r typecheck && pnpm -r test && pnpm lint

# Codegen is canonical (drift-clean + idempotent):
pnpm -F @glyphs-ai/sdk gen && git diff --exit-code packages/sdk/src/generated/

# Heartbeat + end sentinel are observable in the api integration test:
pnpm -F @glyphs-ai/api exec vitest run test/routes/tasks.test.ts -t "activity/stream"

# Reconnect/backoff/abort policy:
pnpm -F @glyphs-ai/dashboard exec vitest run test/hooks/useReconnectingStream.test.ts
```

All packages are green locally (typecheck, build, test, lint) and the SDK codegen is
drift-clean.

## Notes for review

- **Heartbeat/end observability lives in an api-level integration test**, not e2e. The `e2e`
  package has no live-server SSE harness (it's architecture / wire-shape / CLI-smoke only);
  standing up a real server + runtime that emits activity purely to observe a 15s heartbeat is
  disproportionate. The api test drives the handler's real `ReadableStream` with fake timers,
  so the heartbeat + `end` frames are asserted on real bytes. Flag if you'd prefer a live e2e
  leg anyway.
- `useReconnectingStream` is ~90 LoC (issue estimated ~50); the extra lines are the
  abort-aware `sleep` helper and doc comments, not extra policy.
- Unrelated to this PR: a clean checkout has no `packages/contracts/` (it was dropped in the
  base commit `a1003a2`); a stale gitignored `dist/`+`node_modules/` leftover in the working
  tree can trip `tier-invisibility.test.ts`. Nothing tracked changed.
