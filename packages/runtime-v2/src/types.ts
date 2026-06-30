/**
 * Data types for the runtime-v2 contract. These are pure structural
 * shapes (no behaviour) reused verbatim across the runtime boundary.
 * They are intentionally identical in shape to `@glyphs-ai/runtime`'s
 * equivalents so a v1 runtime's return values satisfy the v2 interface
 * by structural typing — the api-side v1→v2 bridge passes them through
 * without copying.
 */

/**
 * Minimal resolved-agent shape consumed by runtime adapters during
 * {@link Runtime.provision}. Declared here (not imported from
 * `@glyphs-ai/catalog`) so this package depends on the catalog only by
 * structural typing — any object satisfying this shape works.
 */
export interface ResolvedAgent {
  readonly agent: { readonly fqn: string };
  readonly skills: readonly { readonly skill: { readonly fqn: string } }[];
  readonly mcps: readonly { readonly fqn: string }[];
}

/**
 * Minimal capability surface a content provider must implement for
 * runtime adapters to materialise a workdir. `AgentContentSource` from
 * `@glyphs-ai/catalog` satisfies this interface; runtime-v2 never
 * imports from catalog.
 */
export interface AgentContentSource {
  resolveAgent(agentFqn: string): Promise<ResolvedAgent>;
  agentEntries(agentFqn: string): AsyncIterable<{ relPath: string; content: Buffer }>;
  skillEntries(skillFqn: string): AsyncIterable<{ relPath: string; content: Buffer }>;
  /** MCP spec as a parsed JSON object, ready to embed under `mcpServers`. */
  getMcpRuntimeConfig(mcpFqn: string): Promise<Record<string, unknown>>;
}

/** Optional capability flags advertised by a {@link Runtime}. */
export interface RuntimeCapabilities {
  /** Whether {@link Runtime.buildInteractiveLaunch} supports `opts.remote = true`. */
  readonly remoteSession?: boolean;
}

/** Inputs to {@link Runtime.provision}. */
export interface ProvisionOpts {
  /** Directory the runtime should materialise for this conversation. */
  readonly workdir: string;
  /** Resolved agent + dependency graph to bake into the workdir. */
  readonly agent: ResolvedAgent;
  /** Content source for agent, skill, and MCP bytes. */
  readonly contentSource: AgentContentSource;
  /** Absolute path of the workspace this conversation belongs to. */
  readonly workspaceDir: string;
}

/** Per-launch flags handed to {@link Runtime.buildInteractiveLaunch}. */
export interface BuildInteractiveLaunchOpts {
  /** Directory the CLI should run in (becomes {@link LaunchCommand.cwd}). */
  readonly workdir: string;
  /** Absolute path of the workspace this conversation belongs to. */
  readonly workspaceDir: string;
  /** Enable remote control of the interactive session, when supported. */
  readonly remote?: boolean;
}

/**
 * Runtime-managed display metadata for one `runtimeSessionId`, surfaced
 * by {@link Runtime.readMetadata}.
 */
export interface RuntimeSessionMetadata {
  /** Short user-facing label the CLI generates from the first prompt. */
  readonly title: string | null;
  /** True when the user explicitly renamed the session via the CLI. */
  readonly userTitled: boolean;
  /** Last-active ISO timestamp from the runtime's own clock. */
  readonly lastActiveAt: string | null;
}

/**
 * A shell-runnable launch command, returned by
 * {@link Runtime.buildInteractiveLaunch}. The `cmd`/`args`/`cwd` triple
 * is suitable for `child_process.spawn`; `display` is a single-line
 * string suitable for showing to the user or copying to the clipboard.
 */
export interface LaunchCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly display: string;
  /** Optional env vars the spawned terminal session should inherit. */
  readonly env?: Readonly<Record<string, string>>;
}
