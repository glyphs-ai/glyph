# @glyphs-ai/runtime-v2

> **Tier:** T0 (Foundations / provider). See the [tier model](../../docs/architecture.md#tier-model).

The Result-based, neverthrow-native runtime contract. A strangler-fig
successor to [`@glyphs-ai/runtime`](../runtime): same domain-agnostic
"adapt a third-party CLI for glyph" role, but every behavioural method
returns a `ResultAsync` with a discriminated-union error instead of
throwing.

## Why

`@glyphs-ai/runtime` is throw-based (its `RuntimeRegistry.get` throws,
its `Runtime.provision` rejects, several methods are optional). T1
managers that have adopted neverthrow (starting with
[`@glyphs-ai/session`](../session)) want a Result-based runtime they can
call directly — no per-manager throw→Result anti-corruption layer.

Rather than convert the whole runtime package and every consumer at
once, this package introduces the v2 contract incrementally:

- **runtime-v2** owns the Result-based `Runtime` interface, a
  `RuntimeRegistry` lookup port, the shared data types, and the DU error
  atoms. It contains **no concrete CLI adapters**.
- The composition root (`@glyphs-ai/api`) **bridges** the existing v1
  `CopilotRuntime` into this v2 shape (throw → DU; data types pass
  through by structural typing) and hands `@glyphs-ai/session` a v2
  registry.
- `@glyphs-ai/task` / `@glyphs-ai/server` keep using v1 untouched.

When a concrete adapter (e.g. copilot) implements v2 natively, its
bridge is dropped; when every consumer is on v2, v1 is retired and this
package takes the `runtime` name.

## Surface

```
packages/runtime-v2/src/
  types.ts            data shapes: ResolvedAgent, AgentContentSource,
                      LaunchCommand, RuntimeSessionMetadata,
                      RuntimeCapabilities, ProvisionOpts,
                      BuildInteractiveLaunchOpts
  errors.ts           DU atoms: UnknownRuntime, RuntimeProvisionFailed,
                      RuntimeLaunchFailed, RuntimeStateDeletionFailed
  runtime.ts          Runtime interface (Result-based)
  runtime-registry.ts RuntimeRegistry port + InMemoryRuntimeRegistry
  index.ts            public barrel
```

The current `Runtime` surface covers the interactive-session lifecycle
(`provision` / `buildInteractiveLaunch` / `readMetadata` /
`deleteState`) — the needs of the first consumer. Headless execution and
the activity/observability surface are added when task / server migrate.

## Testing

```sh
pnpm --filter @glyphs-ai/runtime-v2 typecheck
pnpm --filter @glyphs-ai/runtime-v2 test
```

## License

MIT
