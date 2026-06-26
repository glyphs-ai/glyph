@glyphs-ai/sdk
==============

A fully-typed REST client for the glyph HTTP API, **generated** from the
OpenAPI 3.1 spec that `@glyphs-ai/server` emits at `/api/openapi.json`. The
typed surface (one function per route + every request/response type) is
produced by [`@hey-api/openapi-ts`](https://heyapi.dev) and committed under
`src/generated/`; the only hand-written code is a thin `unwrap` /
`GlyphError` ergonomics layer.

> **Node 22 is a devtime requirement only.** `package.json` declares
> `engines.node >=22` because codegen and the test suite run on Node 22.
> The *published* output is runtime-agnostic and safe to bundle for the
> browser — see *Browser safety* below.

What this is — and is not
-------------------------

- ✅ A typed client for the **REST** surface of the glyph API.
- ✅ **Zero runtime dependencies.** The generated fetch client is inlined
  into `src/generated/`, so nothing is pulled from npm at runtime — the
  package is safe to bundle for the browser (see *Browser safety*).
- 🚫 **Not** a streaming client. SSE / `text/event-stream` endpoints (the
  task activity stream, etc.) cannot be described by OpenAPI and are **out
  of scope**. Consume those directly with `EventSource` / `fetch` in the
  calling surface. Any stub the generator emits for a stream response is
  harmless type noise — do not rely on it.

Install / use
-------------

The package resolves over `workspace:*` inside this monorepo. Point the
client at a base URL, then call any operation. Operations are named
`<method><PascalCasePath>` (e.g. `getApiHealth` for `GET /api/health`).

```ts
import { client, getApiHealth, unwrap } from "@glyphs-ai/sdk";

client.setConfig({ baseUrl: "http://127.0.0.1:4123" });

const health = unwrap(await getApiHealth());
console.log(health.status); // "ok"
```

`import { sdk } from "@glyphs-ai/sdk"` is also available as a flat
namespace of every operation (`sdk.getApiHealth(...)`), if you prefer a
single binding over named imports.

Error model
-----------

Every operation returns hey-api's `{ data, error, response }` tuple. Pass
it through `unwrap()` to get the payload or a normalised `GlyphError`:

```ts
import { GlyphError, isGlyphError, unwrap, unwrapOr } from "@glyphs-ai/sdk";

try {
  const ws = unwrap(await getApiWorkspaces());
} catch (err) {
  if (isGlyphError(err)) {
    err.status;   // number
    err.code;     // string | undefined  (e.g. "ValidationError")
    err.issues;   // [{ path, message }] | undefined  (validation 400s)
    err.response; // the raw Response
  }
}

// Non-throwing variant:
const list = unwrapOr(await getApiWorkspaces(), []);
```

Normalisation rules:

- `400 { error, code: "ValidationError", issues }` → `GlyphError` with
  `code` and `issues` populated.
- Any other `4xx` / `5xx` `{ error, code? }` → `GlyphError` carrying the
  message (and `code` when present).
- Non-JSON error body → `GlyphError` whose message is the response status
  text.
- A transport-level failure (offline / DNS / abort) is re-thrown as-is.

The helpers are pure normalisation — no retries, no auth, no logging.

Regenerating the client
------------------------

The generated tree is committed and **CI fails if it drifts** from a fresh
run (`sdk-codegen-drift` job). Whenever the API schema or routes change:

```sh
pnpm build                    # generator reads built @glyphs-ai/server source
pnpm -F @glyphs-ai/sdk gen    # rewrites src/generated/
# commit src/generated/ alongside the schema change
```

`gen` assembles the server's OpenAPI app in-process (no socket, no port),
fetches the spec, and runs the generator. It is deterministic: repeated
runs on the same spec produce byte-identical output.

Browser safety
--------------

`test/bundle-browser.test.ts` bundles the package with Vite in browser mode
and asserts the output contains **no** `node:` imports and no
`require("fs" | "path" | "child_process")`. If a future generator release
starts leaking Node-only code into the client, that test fails loudly.

Versioning
----------

`@hey-api/openapi-ts` and the fetch-client plugin are **pinned to exact
versions** (the project is pre-1.0; breaking changes ship in minor bumps).
Upgrade deliberately: bump the pins, run `pnpm -F @glyphs-ai/sdk gen`,
review the `src/generated/` diff, and run the quality gate before merging.
