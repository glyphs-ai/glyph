/**
 * SDK-based headless launch for the Copilot runtime.
 *
 * We instantiate one {@link CopilotClient} per headless launch. Each client spawns
 * its own CLI subprocess via the SDK so per-launch `workingDirectory`
 * isolation is preserved (any tool that resolves paths against
 * `process.cwd()` rather than the session's workingDirectory would
 * otherwise leak across concurrent launches under a shared client).
 *
 * Events arrive via `onEvent` (registered BEFORE `createSession`'s RPC
 * fires, so even the early `session.start` event lands in our buffer).
 * Every event is pushed into an in-memory `SessionEvent[]` and fanned
 * out to subscribers. The {@link CopilotRuntime} keeps a
 * `Map<sessionId, EventBuffer>` and serves `readActivity` /
 * `streamActivity` from it directly — no `events.jsonl` polling.
 *
 * The returned {@link RuntimeHandle.exit} resolves when `session.idle`
 * fires (model has nothing more to do) OR the underlying client/session
 * errors out. `kill()` calls `session.abort()` (graceful — model
 * finishes the current turn, then stops).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  approveAll,
  CopilotClient,
  type CopilotSession,
  type MCPHTTPServerConfig,
  type MCPServerConfig,
  type MCPStdioServerConfig,
  type SessionEvent,
} from "@github/copilot-sdk";
import { RuntimeHeadlessLaunchFailed, RuntimeProvisionFailed } from "../errors.js";
import type { PlaceholderContext } from "../placeholders.js";
import type { AgentContentSource, ResolvedAgent, RuntimeExit, RuntimeHandle } from "../types.js";
import { InvalidMcpJson } from "./errors.js";
import { COPILOT_MCP_CONFIG, provisionCopilotWorkdir } from "./provision.js";

export { COPILOT_MCP_CONFIG };

/**
 * Per-session in-memory event buffer. The CopilotRuntime keeps a map of
 * sessionId -> EventBuffer so `readActivity` and `streamActivity` have
 * a sync source of truth without going to disk.
 */
export interface EventBuffer {
  /** All events captured so far, in arrival order. */
  readonly events: SessionEvent[];
  /**
   * Resolves true when the session has finished (idle + done). Set by
   * the launcher's exit watcher. Allows `readActivity` callers to
   * know whether they're looking at a still-streaming session vs a
   * completed one (the terminal `session.idle` already implies done
   * for `-p`-style one-shot runs).
   */
  finished: boolean;
  /**
   * Subscribers added by {@link CopilotRuntime.streamActivity}. Each
   * is invoked once per event with the freshly-pushed event. Stored
   * here so the launcher's event handler can fan out to live
   * subscribers without the runtime having to wrap the SDK session.
   */
  readonly subscribers: Set<(event: SessionEvent) => void>;
}

export interface LaunchCopilotHeadlessOpts {
  readonly workdir: string;
  readonly agent: ResolvedAgent;
  readonly catalog: AgentContentSource;
  readonly prompt: string;
  /**
   * Absolute path of the workspace this headless run belongs to. Forwarded to
   * `provisionCopilotWorkdir` as `${workspaceDir}` for placeholder
   * substitution in MCP specs.
   */
  readonly workspaceDir: string;
  /**
   * Optional bag merged into the spawned subprocess's environment on
   * top of `process.env`. The SDK forwards these to its CLI subprocess
   * via the `env` option on {@link CopilotClient}.
   */
  readonly subprocessEnv?: NodeJS.ProcessEnv;
}

export interface LaunchCopilotHeadlessDeps {
  /**
   * Where the CLI server writes per-session state on disk. Matches
   * the SDK's default of `~/.copilot/session-state/`. glyph does
   * NOT pass a custom home to the SDK client because inherited auth
   * lives in `~/.copilot`. This dir is consulted only by
   * {@link CopilotRuntime}'s disk-fallback `readActivity` on
   * orphan-recovered sessions that have no in-memory event buffer.
   */
  readonly copilotStateDir: string;
  /**
   * Absolute path resolved as `${sharedDir}` during provision-time
   * placeholder substitution in MCP specs.
   */
  readonly sharedDir: string;
  /**
   * Optional test seam: inject a fake CopilotClient factory. Production
   * uses the SDK's real `CopilotClient` constructor.
   */
  readonly createClient?: (opts: ConstructorParameters<typeof CopilotClient>[0]) => CopilotClient;
  /**
   * Required: the CopilotRuntime registers the session's event buffer
   * via this callback so `readActivity` / `streamActivity` can find it
   * after launch returns. Unregistered by `CopilotRuntime.deleteState`.
   */
  readonly registerSession: (sessionId: string, buffer: EventBuffer) => void;
}

/**
 * Spawn the SDK client, create a session pointed at `workdir`, send the
 * prompt, and return a live {@link RuntimeHandle}. The runtime's own
 * cleanup is on `kill()` (graceful abort) or on the natural exit of the
 * session (`session.idle`).
 *
 * Sequence:
 *   1. Provision the workdir (AGENTS.md, .mcp.json, .github/skills, …).
 *   2. Start a per-launch `CopilotClient`. The SDK spawns Copilot CLI
 *      in server mode under the hood. The client process is owned
 *      by the SDK; we just keep the handle so we can `stop()` it
 *      from the exit watcher.
 *   3. Wire the per-session event buffer + `session.idle` latch.
 *   4. Read `<workdir>/.mcp.json` (if present) — polyfill for the
 *      SDK's missing MCP discovery; the file is still the source
 *      of truth on disk.
 *   5. Create the session with `workingDirectory: workdir`,
 *      `enableConfigDiscovery: true` (skills/instructions auto-load),
 *      the loaded `mcpServers`, and the buffering `onEvent` handler.
 *   6. Send the prompt via `session.send` (fire-and-forget — exit
 *      watcher tracks `session.idle`).
 *   7. Register the buffer with the CopilotRuntime so the dashboard
 *      can pull activity through `readActivity(runtimeSessionId)`.
 *   8. Build the exit promise + cleanup hooks.
 */
export async function launchCopilotHeadless(
  opts: LaunchCopilotHeadlessOpts,
  deps: LaunchCopilotHeadlessDeps,
): Promise<RuntimeHandle> {
  // Step 1: provision. Distinguishable from spawn failures via error type.
  const placeholders: PlaceholderContext = {
    workspaceDir: opts.workspaceDir,
    sharedDir: deps.sharedDir,
  };
  try {
    await provisionCopilotWorkdir(opts.workdir, opts.agent, opts.catalog, placeholders);
  } catch (cause) {
    throw new RuntimeProvisionFailed("copilot", opts.workdir, cause as Error);
  }

  // Step 2: start the SDK client.
  //
  // Auth model: glyph assumes the operator (the human running the
  // glyph server) is already logged in via `copilot --login`. That
  // login state lives in `~/.copilot/` (config.json + OS keychain
  // tokens). We do NOT pass `copilotHome` so the SDK defaults to
  // `~/.copilot` and inherits the operator's auth.
  //
  // `useLoggedInUser: true` is the SDK default, set explicitly so
  // setting per-session `gitHubToken` (BYOK) does not accidentally
  // also switch this default — the SDK documented
  // behavior is that providing `gitHubToken` implicitly flips this
  // to false.
  const createClient = deps.createClient ?? ((opts) => new CopilotClient(opts));
  const client = createClient({
    useLoggedInUser: true,
    env: mergeEnv(process.env, opts.subprocessEnv),
  });

  try {
    await client.start();
  } catch (cause) {
    throw new RuntimeHeadlessLaunchFailed("copilot", opts.workdir, cause as Error);
  }

  // Step 3: per-session event buffer + idle latch.
  const buffer: EventBuffer = {
    events: [],
    finished: false,
    subscribers: new Set(),
  };

  let idleResolve: ((info: RuntimeExit) => void) | undefined;
  const idlePromise = new Promise<RuntimeExit>((resolve) => {
    idleResolve = resolve;
  });

  const onEvent = (event: SessionEvent) => {
    buffer.events.push(event);
    for (const sub of buffer.subscribers) {
      try {
        sub(event);
      } catch {
        // A subscriber throwing must not break the event pipeline.
        // The streamActivity contract on the runtime side already
        // handles abort signals; surface anything else via its own
        // error channel, not ours.
      }
    }
    // `session.idle` signals the model has no more work — terminal
    // event for one-shot dispatches.
    if (event.type === "session.idle") {
      buffer.finished = true;
      idleResolve?.({ code: 0, signal: null });
    }
  };

  // Step 4: load MCP servers from `<workdir>/.mcp.json` and pass them
  // inline to createSession. The SDK's `enableConfigDiscovery: true`
  // is documented to pick up `.mcp.json` from `workingDirectory`,
  // but the bundled CLI's `_doInitializeMcp` only consumes
  // `SessionConfig.mcpServers` (verified against
  // @github/copilot-sdk@1.0.0-beta.4). This call polyfills the
  // missing discovery; `.mcp.json` remains the source of truth on
  // disk for debuggability and inspection.
  let mcpServers: Record<string, MCPServerConfig> | undefined;
  try {
    mcpServers = await readMcpServersFromWorkdir(opts.workdir);
  } catch (cause) {
    await safeStop(client);
    throw new RuntimeHeadlessLaunchFailed("copilot", opts.workdir, cause as Error);
  }

  // Step 5: create the session.
  let session: CopilotSession;
  try {
    session = await client.createSession({
      onPermissionRequest: approveAll,
      workingDirectory: opts.workdir,
      // Auto-discovers skill / instruction directories from the
      // workdir. (MCP files are NOT discovered; we pass them
      // explicitly above — see step 4.)
      enableConfigDiscovery: true,
      ...(mcpServers ? { mcpServers } : {}),
      // Register the event handler BEFORE the create RPC fires so
      // the very early `session.start` event is delivered to us.
      onEvent,
    });
  } catch (cause) {
    // Best-effort: shut the client down so we don't leak a copilot
    // CLI subprocess behind the rejected launch.
    await safeStop(client);
    throw new RuntimeHeadlessLaunchFailed("copilot", opts.workdir, cause as Error);
  }

  // Step 6: send the prompt. `send` returns once the message is
  // queued; the SDK fires events asynchronously as the agent works.
  try {
    await session.send({ prompt: opts.prompt });
  } catch (cause) {
    await safeDisconnect(session);
    await safeStop(client);
    throw new RuntimeHeadlessLaunchFailed("copilot", opts.workdir, cause as Error);
  }

  // Step 7: register the buffer only after a successful prompt send.
  deps.registerSession(session.sessionId, buffer);

  // Step 8: build the exit promise. Resolves on session.idle (handled
  // in onEvent above) OR if we detect the client dropping (rare —
  // SDK CLI subprocess crash). Closes the SDK client and session
  // when settling so resources don't leak.
  const exit = idlePromise.finally(async () => {
    await safeDisconnect(session);
    await safeStop(client);
  });

  return {
    runtimeSessionId: session.sessionId,
    sessionDir: Promise.resolve(path.join(deps.copilotStateDir, session.sessionId)),
    exit,
    kill: () => {
      // `session.abort()` is graceful: the model is told to stop,
      // and `session.idle` fires shortly after. We don't await it
      // — the exit watcher will see the idle event and clean up.
      session.abort().catch(() => {
        // Already aborted or session is in a state that can't be
        // aborted. Cleanup remains owned by the exit watcher.
      });
    },
  };
}

async function safeDisconnect(session: CopilotSession): Promise<void> {
  try {
    await session.disconnect();
  } catch {
    // Already disconnected. We've fired our exit event; nothing
    // else to do.
  }
}

async function safeStop(client: CopilotClient): Promise<void> {
  try {
    await client.stop();
  } catch {
    // Client was never fully started or has already stopped. The
    // SDK's `forceStop` would also work but is more disruptive
    // (skips graceful cleanup); we prefer the soft path.
  }
}

/**
 * Merge an override bag on top of a parent env, honouring `undefined`
 * as "delete this key from the parent". Returns a fresh object so the
 * SDK / spawn can take ownership without aliasing.
 *
 * Required because the SDK's `CopilotClient({ env })` REPLACES
 * `process.env` for the spawned CLI subprocess rather than merging.
 * Passing only glyph's own GLYPH_* additions would strip Windows
 * system vars (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `PATH`,
 * `PATHEXT`, …) that downstream tools (`gh`, `git`, native build
 * toolchains) need to function — `gh auth status` in particular
 * cannot reach the Windows Credential Manager without USERPROFILE.
 */
function mergeEnv(
  parent: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  if (!overrides) return { ...parent };
  const out: NodeJS.ProcessEnv = { ...parent };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read `<workdir>/.mcp.json` written by {@link provisionCopilotWorkdir}
 * and return its `mcpServers` map shaped for `SessionConfig.mcpServers`.
 *
 * Returns `undefined` if the file doesn't exist (agents without MCP
 * dependencies skip the write in `writeMcpConfig`, see provision.ts).
 *
 * Injects `tools: ["*"]` on any server missing the field — the SDK's
 * `MCPServerConfigBase.tools` is required (`"*"` = expose every tool
 * the server advertises). An explicit empty array on disk is preserved
 * as "no tools" so authors can narrow exposure when needed.
 *
 * Throws {@link InvalidMcpJson} on malformed JSON or unexpected shape so
 * the caller can wrap it as `RuntimeHeadlessLaunchFailed` while preserving
 * the typed cause (consumers pattern-matching on `instanceof InvalidMcpJson`
 * via `.cause` still get the per-MCP attribution). The "name" slot carries
 * `.mcp.json` for whole-file failures and the offending server name for
 * per-server shape failures. ENOENT is not an error.
 */
async function readMcpServersFromWorkdir(
  workdir: string,
): Promise<Record<string, MCPServerConfig> | undefined> {
  const file = path.join(workdir, COPILOT_MCP_CONFIG);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    // Use the file name as the "name" slot — top-level parse failure
    // has no per-server attribution, but typing the failure as
    // InvalidMcpJson keeps the consumer's `instanceof` check working
    // (the outer RuntimeHeadlessLaunchFailed.cause carries it intact).
    throw new InvalidMcpJson(COPILOT_MCP_CONFIG, cause as Error);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("mcpServers" in parsed) ||
    typeof (parsed as { mcpServers: unknown }).mcpServers !== "object" ||
    (parsed as { mcpServers: unknown }).mcpServers === null ||
    Array.isArray((parsed as { mcpServers: unknown }).mcpServers)
  ) {
    throw new InvalidMcpJson(
      COPILOT_MCP_CONFIG,
      new Error(`expected { mcpServers: { ... } } at top level`),
    );
  }

  const sourceMap = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
  if (Object.keys(sourceMap).length === 0) return undefined;

  const out: Record<string, MCPServerConfig> = {};
  for (const [name, body] of Object.entries(sourceMap)) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new InvalidMcpJson(name, new Error(`server config must be an object`));
    }
    out[name] = coerceMcpServerConfig(name, body as Record<string, unknown>);
  }
  return out;
}

function coerceMcpServerConfig(name: string, body: Record<string, unknown>): MCPServerConfig {
  const tools = "tools" in body ? readStringArray(body.tools) : ["*"];
  if (tools === null) {
    throw new InvalidMcpJson(name, new Error(`server config tools must be a string array`));
  }

  const timeout = readOptionalNumber(body.timeout);
  if (body.timeout !== undefined && timeout === undefined) {
    throw new InvalidMcpJson(name, new Error(`server config timeout must be a finite number`));
  }

  if (body.type === "http" || body.type === "sse") {
    const url = readString(body.url);
    if (url === undefined) {
      throw new InvalidMcpJson(name, new Error(`server config url must be a string`));
    }
    const headers = readOptionalStringRecord(body.headers);
    if (body.headers !== undefined && headers === undefined) {
      throw new InvalidMcpJson(name, new Error(`server config headers must be a string map`));
    }
    const config: MCPHTTPServerConfig = {
      type: body.type,
      url,
      tools,
      ...(headers !== undefined ? { headers } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
    return config;
  }

  if (body.type !== undefined && body.type !== "local" && body.type !== "stdio") {
    throw new InvalidMcpJson(
      name,
      new Error(`server config type must be "stdio", "local", "http", or "sse"`),
    );
  }

  const command = readString(body.command);
  if (command === undefined) {
    throw new InvalidMcpJson(name, new Error(`server config command must be a string`));
  }
  const args = readStringArray(body.args);
  if (args === null) {
    throw new InvalidMcpJson(name, new Error(`server config args must be a string array`));
  }
  const env = readOptionalStringRecord(body.env);
  if (body.env !== undefined && env === undefined) {
    throw new InvalidMcpJson(name, new Error(`server config env must be a string map`));
  }
  const cwd = readString(body.cwd);
  if (body.cwd !== undefined && cwd === undefined) {
    throw new InvalidMcpJson(name, new Error(`server config cwd must be a string`));
  }
  const config: MCPStdioServerConfig = {
    ...(body.type !== undefined ? { type: body.type } : {}),
    command,
    args,
    tools,
    ...(env !== undefined ? { env } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
  return config;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string") ? value : null;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    out[key] = item;
  }
  return out;
}
