/**
 * Consumer-owned port contracts for @glyphs-ai/session. Catalog
 * structurally satisfies `AgentResolverPort` so the session pkg does
 * not need to depend on `@glyphs-ai/catalog` directly; the terminal
 * pkg's `spawnTerminal` structurally satisfies `SpawnFn` so the
 * session pkg does not need to depend on `@glyphs-ai/terminal` either.
 *
 * Not-found discrimination is by `null` return from `getAgentEntry`,
 * not by a thrown typed error. A throw from `resolveAgent` is treated
 * as a system fault by `SessionService.create` (mapped to
 * `AgentResolutionFailedError` → 500). The catalog's own
 * `AgentNotFoundError` class is intentionally not imported here.
 */

import type { LaunchCommand, ResolvedAgent } from "@glyphs-ai/runtime";

export interface AgentEntry {
  readonly status: "ready" | "blocked";
}

export interface AgentResolverPort {
  getAgentEntry(name: string): Promise<AgentEntry | null>;
  resolveAgent(name: string): Promise<ResolvedAgent>;
}

/**
 * Structural result shape returned by an injected {@link SpawnFn}.
 *
 * Deliberately a minimal interface — `launcher` is typed `string` here
 * (not the closed `Launcher` union from `@glyphs-ai/terminal`) so this
 * package never imports `@glyphs-ai/terminal`, even type-only. Today's
 * production wiring passes `spawnTerminal` from `@glyphs-ai/terminal`,
 * whose `SpawnTerminalResult = { launcher: Launcher }` is structurally
 * assignable here because `Launcher` is a `string` subtype.
 *
 * Consumers that need the narrower union (e.g. dashboard rendering)
 * import from `@glyphs-ai/terminal` directly.
 */
export interface SpawnInteractiveResult {
  readonly launcher: string;
}

/**
 * Injection seam for hosting the `LaunchCommand` produced by
 * `Runtime.buildInteractiveLaunch`. Wired by `composeApplication` (in
 * `@glyphs-ai/api`), which value-imports `@glyphs-ai/terminal`'s
 * `spawnTerminal` and threads it through `composeSessionModule` →
 * `SessionService` constructor. Session itself never value-imports
 * (or even type-imports) terminal, so the cross-domain architecture
 * fence (`packages/e2e/test/architecture/inter-service-imports.test.ts`)
 * stays intact and session does not need terminal in its dep graph.
 *
 * Structurally typed: `spawnTerminal` from `@glyphs-ai/terminal`, a test
 * fake, or any alternative spawner with the same shape is acceptable.
 */
export type SpawnFn = (launch: LaunchCommand) => Promise<SpawnInteractiveResult>;
