# Phase 7 — SSE schema investigation (3.1 `oneOf` vs 3.2 `itemSchema`)

**Tracking:** #120 · **Branch:** `phase7/sse` · **Base:** `main` @ `a1003a2`

**Verdict (TL;DR):** Ship **OpenAPI 3.1** with a `oneOf` over the raw SSE `data:`
payloads. 3.2 `itemSchema` is a dead end in our toolchain **today**: `@hono/zod-openapi`
cannot emit a 3.2 document, and `@hey-api/openapi-ts@0.99.0` ignores `itemSchema`
(it emits `200: unknown`). Both claims were verified by actually running the tools,
not by reading changelogs.

---

## 1. Ecosystem check

| Tool | Version | Relevant capability | Result |
|---|---|---|---|
| `@hey-api/openapi-ts` | **0.99.0** | Detects `text/event-stream` responses → generates `client.sse.get()` + `ServerSentEventsResult` async iterator | ✅ works |
| `@hey-api/openapi-ts` | 0.99.0 | Reads OpenAPI **3.2** `content.itemSchema` to type stream events | ❌ **ignored** — `itemSchema` appears only in `.mjs.map` source maps, never in runtime code; fed a 3.2 spec it emits `200: unknown` |
| `@hono/zod-openapi` | **1.4.0** | Declare non-JSON response content (`text/event-stream`) | ✅ works (content is an arbitrary media-type map) |
| `@asteasolutions/zod-to-openapi` (transitive) | **8.5.0** | Emit an `openapi: "3.2.0"` document | ❌ **cannot** — only exports `OpenApiGeneratorV3` (3.0) and `OpenApiGeneratorV31` (3.1); `openApiVersions = ["3.0.0","3.0.1","3.0.2","3.0.3","3.1.0"]` |
| `zod` | 4.4.3 | `z.union` / `z.discriminatedUnion` → `oneOf` | ✅ works |

Evidence commands (all run against the committed `node_modules`):

```
# hey-api never reads itemSchema at runtime — only in source maps:
$ grep -rl itemSchema <hey-api>/dist --include='*.mjs' --include='*.js' --include='*.d.ts'
(no output)

# zod-to-openapi tops out at 3.1.0:
$ grep -n 'openApiVersions' <zod-to-openapi>/dist/openapi-generator.d.ts
declare const openApiVersions: readonly ["3.0.0","3.0.1","3.0.2","3.0.3","3.1.0"];
```

**Consequence:** even if hey-api *did* read `itemSchema`, we could not produce a 3.2
document from our server (the doc is assembled by `@hono/zod-openapi`, whose
`getOpenAPI31Document()` and transitive `zod-to-openapi` cap at 3.1.0). 3.2 is doubly
blocked.

---

## 2. Prototypes (both actually generated via `pnpm -F @glyphs-ai/sdk gen`)

Two throwaway endpoints were mounted in `tasks.ts` and regenerated in a single
`gen` run so the outputs are directly comparable. Both were reverted before Phase B.

### Prototype A1 — 3.1 `oneOf` over raw `data:` payloads (byte-compatible)

Schema: `z.union([ActivityItemSchema, z.object({ error: z.string() }), z.object({})])`
on `content: { "text/event-stream": { schema } }`.

hey-api generated a **typed SSE operation**:

```ts
export const getApiWorkspacesByIdTasksScratchSseUnion = <ThrowOnError extends boolean = false>(
  options: Options<..., ThrowOnError, ...Response>
): Promise<ServerSentEventsResult<GetApiWorkspacesByIdTasksScratchSseUnionResponses>> =>
  (options.client ?? client).sse.get<...>({ url: '/api/workspaces/{id}/tasks/_scratch/sse-union', ...options });
```

…backed by this response type (abridged):

```ts
200:
    { seq; timestamp; kind: 'user'; text; attachments?… }
  | { …; kind: 'assistant'; … }
  | { …; kind: 'thinking'; … }
  | { …; kind: 'tool_call'; … }
  | { …; kind: 'system'; … }
  | { …; kind: 'summary'; … }
  | { error: string }
  | { [key: string]: unknown };   // ← z.object({}) (heartbeat / end)
```

- ✅ `activity` payload is the **full `ActivityItem` discriminated union** — narrowable on
  `kind`. This is the payload that matters, and it was `unknown` before.
- The `stream` async iterator yields `Responses[keyof Responses]` = that union.
- `{}` (heartbeat/end) widens to `{ [key: string]: unknown }`, so the *stream iterator
  alone cannot tell `heartbeat` from `end`* — both consumers must route on the SSE
  `event:` name (hey-api exposes it via `onSseEvent`), which they already do today.
- **Byte-compatible:** the `activity` frame's `data:` stays raw `JSON.stringify(item)`.

### Prototype A2 — 3.1 `discriminatedUnion` envelope (`const` tag) — *rejected*

Schema: `z.discriminatedUnion("event", [ {event:'activity', id, data:ActivityItem}, {event:'heartbeat', data:{}}, {event:'end', data:{}}, {event:'error', data:{error}} ])`.

hey-api generated a **clean discriminated union**:

```ts
200:
    { event: 'activity'; id: number; data: <ActivityItem union> }
  | { event: 'heartbeat'; data: { [key: string]: unknown } }
  | { event: 'end';       data: { [key: string]: unknown } }
  | { event: 'error';     data: { error: string } }
```

This is the **best possible DX** — `for await (const ev of stream) switch (ev.event)`
narrows `ev.data` perfectly, no `onSseEvent` needed. **But it is unshippable**: it
requires the SSE `data:` line to carry the envelope `{event,id,data}`, which changes the
`activity` frame's bytes. Byte-compatibility of `activity` (and `end`) frames is a hard
non-goal in both #120 and the brief (cli/dashboard e2e goldens depend on it). hey-api
does **not** synthesize the envelope from the SSE `event:`/`id:` frame fields — it parses
`data:` as JSON verbatim — so the envelope cannot be a pure "view". Rejected.

### Prototype B — 3.2 `itemSchema` — *not expressible*

We could not build this against our server (zod-to-openapi can't emit 3.2), so it was
tested by feeding hey-api a **hand-written 3.2.0 spec** with `content.itemSchema`:

```ts
// hey-api output for the 3.2 itemSchema spec:
export const getSse32 = (...): Promise<ServerSentEventsResult<GetSse32Responses>> =>
  (options?.client ?? client).sse.get<...>({ url: '/sse32', ...options });
export type GetSse32Responses = { 200: unknown };   // ← itemSchema ignored
```

hey-api still wires `.sse.get()` (it keys off the `text/event-stream` media type), but
the event payload is **`unknown`** — `itemSchema` is dropped on the floor. Zero typing
benefit versus 3.1.

---

## 3. Recommendation

Adopt **Prototype A1 (3.1 `oneOf` over raw data payloads)**.

| Criterion | A1 `oneOf` data-union | A2 envelope | B 3.2 `itemSchema` |
|---|---|---|---|
| Typed `activity` payload | ✅ full `ActivityItem` | ✅ full `ActivityItem` | ❌ `unknown` |
| Clean stream-iterator discriminator | ⚠️ route on `event:` name | ✅ `switch(ev.event)` | ❌ |
| Byte-compatible `activity`/`end` frames | ✅ | ❌ breaks wire | ✅ |
| Expressible in our toolchain | ✅ | ✅ | ❌ can't emit 3.2 |
| Net vs today (`200: unknown`) | **typed** | typed | still `unknown` |

A1 delivers the concrete win #120 asks for — the SSE 200 is a typed event union instead
of an `errorResponse` placeholder, and the SDK exposes a `.sse.get()`-backed operation —
while honoring the byte-compat non-goal. The envelope's marginally nicer iterator DX is
not worth breaking the wire; consumers route on the SSE `event:` name regardless (both do
today), so the union shape loses nothing they actually rely on.

**Implementation notes carried into Phase B:**
- `ActivityStreamEventSchema` = `z.union([ ActivityItemSchema, HeartbeatEventSchema, EndEventSchema, ErrorEventSchema ])`, all with `.strict()`/empty objects as appropriate, attached to the `/{tid}/activity/stream` 200 as `text/event-stream`.
- Consumers use the generated op with `onSseEvent` (carries `event`, `id`, `data`) — CLI routes activity→stdout / end→exit0 / error→exit1; dashboard routes activity→onItem / heartbeat→liveness / end→onEnd / error→onError.
- Heartbeat cadence: 15s (well under the common 30–60s idle-proxy cutoff, cheap on the wire).
