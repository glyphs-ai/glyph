# @glyphs-ai/runtime

> **Tier:** T0 (Foundations). See the [tier model](../../docs/architecture.md#tier-model).

Runtime adapter contract + Copilot CLI implementation.

A *runtime* adapts a third-party CLI (GitHub Copilot today; Gemini,
Claude Code planned) for use by glyph. The interface is
**domain-agnostic** - it doesn't know about glyph's `Session`, `Task`,
or `Workflow` value types. It exposes two execution modes (interactive
vs headless) plus a uniform observability + maintenance surface that
works against either:

- **Interactive** - `provision` (bake an agent into a workdir) +
  `buildInteractiveLaunch` (build the shell command the user runs to
  drop into the CLI).
- **Headless** - `launchHeadless` (spawn the CLI as a detached worker
  that consumes a prompt and exits).
- **Observability** - `readMetadata` (title / lastActiveAt) +
  `readActivity` (paginated parsed timeline) + `getLastAgentActivity`
  (last assistant utterance) + `streamActivity` (live SSE tail).
  All keyed by an opaque `runtimeSessionId`.
- **Maintenance** - `deleteState` (rm the runtime's recorded state
  for one `runtimeSessionId`).

Per-runtime preconditions (folder-trust setup, credential refresh,
license checks, ...) live **inside the adapter**, executed lazily at
the moment they're needed.

## Layout

```
packages/runtime/src/
  types.ts                       Public contract (Runtime, LaunchCommand, ActivityItem, ...)
  errors.ts                      Cross-runtime error classes
  runtime-registry.ts            RuntimeRegistry port + InMemoryRuntimeRegistry (kind -> Runtime lookup)
  placeholders.ts                ${workspaceDir} / ${sharedDir} expansion helpers
  shared-dir.ts                  Shared-state dir helper (cross-runtime)
  copilot/
    copilot-runtime.ts           CopilotRuntime - the canonical adapter
    activity.ts                  ActivityItem translation from Copilot event log
    ids.ts                       Copilot session-id allocators + parsers
    interactive-launch.ts        buildCopilotLaunchCommand (--session-id, --yolo)
    launch-headless.ts           launchCopilotHeadless + mergeEnv + .mcp.json polyfill
    preflight.ts                 assertCopilotSdkResolvable (server-boot SDK presence check)
    provision.ts                 Bake AGENTS.md + .mcp.json into workdir
    state.ts                     workspace.yaml reader (CopilotWorkspaceMetadata)
    streaming.ts                 Live-tail streaming helpers (streamFromBuffer, streamFromDisk)
    trust.ts                     Copilot trustedFolders preflight
    errors.ts                    Copilot-specific subclasses
  index.ts                       public barrel
```

## Contract (simplified)

```ts
interface Runtime {
  readonly kind: string;                          // "copilot", "gemini", ...
  readonly capabilities?: RuntimeCapabilities;

  // Interactive
  provision(opts: ProvisionOpts): Promise<{ runtimeSessionId: string | null }>;

  buildInteractiveLaunch(
    runtimeSessionId: string | null,
    opts: BuildInteractiveLaunchOpts,
  ): Promise<LaunchCommand>;

  // Headless
  launchHeadless?(opts: LaunchHeadlessOpts): Promise<RuntimeHandle>;

  // Observability
  readMetadata(runtimeSessionId: string): Promise<RuntimeSessionMetadata | null>;
  readActivity?(runtimeSessionId: string, opts?: ReadActivityOpts): Promise<ActivityResult | null>;
  getLastAgentActivity?(runtimeSessionId: string): Promise<AgentActivity | null>;
  streamActivity?(runtimeSessionId: string, opts?: StreamActivityOpts): AsyncIterable<ActivityItem>;

  // Maintenance
  deleteState(runtimeSessionId: string): Promise<void>;
}
```

`ResolvedAgent` and `AgentContentSource` are runtime-owned structural
types. They name the shape the runtime needs from any agent / catalog
source; consumers like `@glyphs-ai/catalog` satisfy them by structural
typing without runtime ever importing the catalog package.

## CopilotRuntime

```ts
import { CopilotRuntime, InMemoryRuntimeRegistry } from "@glyphs-ai/runtime";

const runtime = new CopilotRuntime({
  // Cross-cutting env layered into every spawned subprocess
  // (server bootstrap populates this via buildSubprocessEnvBase).
  subprocessEnvBase: { GLYPH_SERVER, GLYPH_SHARED_DIR },
  // Keys to delete from the inherited parent env on the HEADLESS
  // launch path (interactive shells inherit wholesale and cannot
  // unset). Server bootstrap passes ["GLYPH_HOME"].
  subprocessEnvScrub: ["GLYPH_HOME"],
});

const registry = new InMemoryRuntimeRegistry();
registry.register(runtime);
```

`buildInteractiveLaunch` emits `copilot --session-id=<id> --yolo`
(falling back to `--yolo` alone for a fresh session). The package is
verified empirically against Copilot CLI 1.0.44.

## Env contract

`LaunchCommand.env` is `Readonly<Record<string, string>>` - string
values only, no `undefined` (the windows terminal spawner cannot quote
`undefined`, and inlined `export K=v` / `$env:K='v'` forms in display
strings have no representation for "unset"). Two complementary knobs
carry the split semantics:

- `subprocessEnvBase` - positive declarations, applied on every launch
  path (both interactive and headless).
- `subprocessEnvScrub` - "delete from parent env" keys, applied only
  by `launchHeadless` (interactive shells inherit the parent env
  wholesale and have no syntactic way to unset).

See `packages/server/src/subprocess-env.ts` for the canonical
production values.

## Testing

```sh
pnpm --filter @glyphs-ai/runtime test
```

Vitest runs in `forks` pool, matching the other glyph packages - keeps
test-isolation semantics uniform across the monorepo.

## License

MIT