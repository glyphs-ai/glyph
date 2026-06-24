import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  RuntimeDoesNotSupportRemoteError,
  RuntimeProvisionFailed,
  RuntimeReadActivityInvalidArgs,
  RuntimeReadMetadataFailed,
  RuntimeStateDeletionFailed,
} from "../errors.js";
import type { PlaceholderContext } from "../placeholders.js";
import { SHARED_SUBDIR } from "../shared-dir.js";
import type {
  ActivityItem,
  ActivityResult,
  AgentActivity,
  BuildInteractiveLaunchOpts,
  LaunchCommand,
  LaunchHeadlessOpts,
  ProvisionOpts,
  ReadActivityOpts,
  Runtime,
  RuntimeCapabilities,
  RuntimeHandle,
  RuntimeSessionMetadata,
  StreamActivityOpts,
  TruncationInfo,
} from "../types.js";
import { deriveCopilotResult, parseCopilotActivity } from "./activity.js";
import { generateCopilotSessionId, safeCopilotId } from "./ids.js";
import { buildCopilotLaunchCommand } from "./interactive-launch.js";
import {
  type EventBuffer,
  type LaunchCopilotHeadlessDeps,
  launchCopilotHeadless,
} from "./launch-headless.js";
import { provisionCopilotWorkdir } from "./provision.js";
import { readCopilotWorkspaceYaml } from "./state.js";
import {
  COPILOT_RAW_READ_CAP_BYTES,
  serializeEventBuffer,
  streamFromBuffer,
  streamFromDisk,
} from "./streaming.js";
import { ensureDirTrusted } from "./trust.js";

const DEFAULT_COPILOT_STATE_DIR = path.join(homedir(), ".copilot", "session-state");
const DEFAULT_COPILOT_CONFIG_PATH = path.join(homedir(), ".copilot", "config.json");
const DEFAULT_SHARED_DIR = path.join(homedir(), ".glyph", SHARED_SUBDIR);

export interface CopilotRuntimeConfig {
  /**
   * Override the directory where copilot stores per-session state. Defaults
   * to `~/.copilot/session-state`. Tests pass a tmp dir; production callers
   * normally leave this unset.
   */
  readonly copilotStateDir?: string;
  /**
   * Override the Copilot CLI config file we maintain `trustedFolders` in.
   * Defaults to `~/.copilot/config.json` — NOT `settings.json`. The Copilot
   * CLI (verified against 1.0.44) only reads trust state from
   * `config.json`; entries written to `settings.json.trustedFolders` are
   * silently ignored, even though the leading comment in `config.json`
   * misleadingly says "User settings belong in settings.json".
   *
   * Tests pass a tmp path so the real user config file is never mutated.
   *
   * Used exclusively by `buildInteractiveLaunch` (interactive mode preflight);
   * `provision` and `launchHeadless` do NOT touch this
   * file (see class JSDoc for the per-mode trust matrix).
   */
  readonly copilotConfigPath?: string;
  /**
   * Override the directory exposed to spec authors as `${sharedDir}` in
   * placeholder substitution. Defaults to `~/.glyph/shared`. Server
   * bootstrap normally derives this from `GLYPH_HOME` and passes it
   * explicitly so the value tracks any `GLYPH_HOME` override.
   *
   * Per-workspace state should NOT live here — spec authors use
   * `${workspaceDir}` for that. This dir is for state that is shared
   * across every workspace and launch type on the machine
   * (e.g. one playwright login the user wants every project to reuse).
   */
  readonly sharedDir?: string;
  /**
   * Environment variables layered into every spawned subprocess and
   * into every returned `LaunchCommand.env`. The runtime owns this
   * because runtime is the entity that actually spawns / hands off
   * the agent process. T1 managers contribute only their own
   * work-context env (GLYPH_WORK_*, GLYPH_WORKSPACE*) on top.
   *
   * Server bootstrap populates this with `GLYPH_SERVER` and
   * `GLYPH_SHARED_DIR` (see `@glyphs-ai/server`'s
   * `buildSubprocessEnvBase`); other deployments may pass an empty
   * object or omit it entirely. Values are strings only — to scrub
   * a key from the inherited parent env, use {@link subprocessEnvScrub}.
   */
  readonly subprocessEnvBase?: Readonly<Record<string, string>>;
  /**
   * Env keys to delete from the inherited parent env on the headless
   * launch path. Translated into `undefined` overrides for
   * `mergeEnv` inside {@link launchCopilotHeadless}. Interactive
   * launches deliberately do NOT honour this — a user-driven shell
   * owns its own env and `cmd /k` / pwsh `$env:` can only SET, not
   * UNSET. Server bootstrap populates with
   * `SUBPROCESS_ENV_SCRUB_KEYS` (currently `["GLYPH_HOME"]`); other
   * deployments may omit it.
   */
  readonly subprocessEnvScrub?: readonly string[];
  /**
   * Test seam for id generation. Defaults to `crypto.randomUUID`.
   */
  readonly randomUUID?: () => string;
  /**
   * Optional injection of the headless-launch dependencies. Production callers
   * leave this unset; tests pass a stub `createClient` / `registerSession`
   * to avoid actually launching the CLI. Any keys provided here override
   * the top-level options for headless launch only.
   */
  readonly headlessDeps?: Partial<LaunchCopilotHeadlessDeps>;
}

/**
 * The Copilot adapter. For interactive launches it pre-allocates a
 * UUID at provision time and threads it through `--session-id=<id>` so
 * first launch creates the session and subsequent launches resume it.
 * For headless launches the SDK mints the session id itself; the
 * provision-time UUID is unused on that path.
 *
 * # Trust handling — interactive only (Copilot-specific, intentionally NOT abstracted)
 *
 * Trust resolution is a property of the Copilot CLI itself and is
 * intentionally NOT lifted into the cross-runtime `Runtime` interface.
 * Each runtime adapter owns its own preconditions and decides where in
 * its lifecycle to enforce them.
 *
 * Empirically verified against Copilot CLI 1.0.44:
 *
 *   | mode                          | folder-trust gate?           | how to satisfy                |
 *   |-------------------------------|------------------------------|-------------------------------|
 *   | `-i` (interactive)            | yes — `cwd` (or an ancestor) | write `cwd` (or an ancestor)  |
 *   |  i.e. `buildInteractiveLaunch`|   must be in                 |   to `~/.copilot/config.json` |
 *   |                               |   `config.json.trustedFolders` |  `trustedFolders`           |
 *   |                               |   else CLI shows blocking    |                               |
 *   |                               |   "Confirm folder trust"     |                               |
 *   |                               |   prompt                     |                               |
 *   |-------------------------------|------------------------------|-------------------------------|
 *   | SDK headless                  | none — bypassed by the SDK's | nothing                       |
 *   |  i.e. `launchHeadless`        |   `approveAll` permission    |                               |
 *   |                               |   handler                    |                               |
 *
 * Two notes on the table:
 *
 * - The trust file is `config.json`, NOT `settings.json`. The leading
 *   comment in `config.json` says "User settings belong in settings.json.
 *   This file is managed automatically." — that comment is misleading for
 *   `trustedFolders` specifically: the CLI only reads trust from
 *   `config.json`, regardless of where the user writes it. Verified by
 *   placing identical entries in both files and observing that only the
 *   `config.json` entry suppresses the prompt.
 *
 * - `--add-dir` is NOT an alternative for `-i` mode (it's a file-access
 *   allowlist; it does not pre-trust the folder for the interactive
 *   trust gate). The only working knob for `-i` is the persistent
 *   `config.json` entry.
 *
 * Concretely, `buildInteractiveLaunch(runtimeSessionId, opts)` ensures
 * `opts.workspaceDir` is covered by `config.json.trustedFolders`
 * immediately before returning the launch spec. The write is idempotent
 * and ancestor-aware: the first launch in a workspace pays one
 * read+write; every subsequent launch passes `isPathCovered` and
 * short-circuits without writing.
 * `launchHeadless` never touches the file.
 *
 * SECURITY: every method that would compose `runtimeSessionId` into a
 * filesystem path or a `--session-id=<id>` argument runs it through
 * `isCopilotSessionId` first. A tampered `session.json` with a malicious id
 * (e.g. `"../../etc"` for path-traversal, or one with shell metacharacters
 * for the display string) is treated as if the id were null —
 * `readMetadata` / `readActivity` / `getLastAgentActivity` /
 * `streamActivity` return null, `deleteState` is a no-op, and
 * `buildInteractiveLaunch` produces a fresh launch (no `--session-id`).
 * That degrades gracefully for the user and keeps the surface immune
 * to malformed persisted state.
 */
export class CopilotRuntime implements Runtime {
  readonly kind = "copilot";

  /**
   * Capabilities Copilot's CLI implements that other runtimes might
   * not. Read by the server's `/api/runtimes` route → surfaced in the
   * dashboard so the "Spawn remote" button only renders enabled when
   * the active runtime supports it.
   *
   * - `remoteSession`: Copilot CLI 1.0.44+ accepts `--remote` to bridge
   *   the interactive session to a browser / mobile app via GitHub. See
   *   {@link buildInteractiveLaunch} for the per-launch wiring.
   */
  readonly capabilities: RuntimeCapabilities = {
    remoteSession: true,
  };

  private readonly copilotStateDir: string;
  private readonly copilotConfigPath: string;
  private readonly sharedDir: string;
  private readonly subprocessEnvBase: Readonly<Record<string, string>>;
  private readonly subprocessEnvScrub: readonly string[];
  private readonly randomUUID: () => string;
  private readonly headlessDeps: Partial<LaunchCopilotHeadlessDeps>;

  /**
   * Per-headless-session in-memory event buffer. Populated by the SDK-based
   * launcher (`launchCopilotHeadless`) and consumed by `readActivity` /
   * `streamActivity`. Keyed by the SDK-minted session id.
   *
   * Memory lifetime: a buffer is created on `launchHeadless` and
   * dropped on `deleteState`. Server restart wipes the map — the
   * higher-level recovery code then falls back to
   * reading `events.jsonl` off disk (which the SDK's CLI server
   * also writes; the buffer is a faster in-process mirror, not the
   * primary truth source).
   */
  private readonly sessionBuffers = new Map<string, EventBuffer>();

  constructor(opts: CopilotRuntimeConfig = {}) {
    this.copilotStateDir = opts.copilotStateDir ?? DEFAULT_COPILOT_STATE_DIR;
    this.copilotConfigPath = opts.copilotConfigPath ?? DEFAULT_COPILOT_CONFIG_PATH;
    this.sharedDir = opts.sharedDir ?? DEFAULT_SHARED_DIR;
    this.subprocessEnvBase = opts.subprocessEnvBase ?? {};
    this.subprocessEnvScrub = opts.subprocessEnvScrub ?? [];
    this.randomUUID = opts.randomUUID ?? randomUUID;
    this.headlessDeps = opts.headlessDeps ?? {};
  }

  async provision(opts: ProvisionOpts): Promise<{ runtimeSessionId: string }> {
    const placeholders: PlaceholderContext = {
      workspaceDir: opts.workspaceDir,
      sharedDir: this.sharedDir,
    };
    try {
      await provisionCopilotWorkdir(opts.workdir, opts.agent, opts.catalog, placeholders);
    } catch (err) {
      throw new RuntimeProvisionFailed(this.kind, opts.workdir, err as Error);
    }
    const runtimeSessionId = generateCopilotSessionId(this.randomUUID);
    return { runtimeSessionId };
  }

  /**
   * Build the launch incantation for an interactive Copilot session.
   *
   * Preflight side-effect: writes `workspaceDir` (idempotently, with
   * ancestor coverage) into `~/.copilot/config.json` `trustedFolders`
   * via `ensureDirTrusted`. This is the per-mode trust handling the
   * class jsdoc describes — it is intentionally NOT exposed as a
   * cross-runtime `Runtime` method, because trust shape varies across
   * CLIs. The first launch in a workspace pays one read+write; every
   * subsequent launch hits the "already covered" early return and
   * performs only a cheap read.
   *
   * If the trust write fails, the launch fails (`TrustRegistrationFailed`
   * propagates). That is the right behaviour: spawning Copilot anyway
   * would just stall on the blocking "Confirm folder trust" prompt
   * inside the freshly-spawned terminal, which is much worse UX than a
   * surfaced error in the dashboard.
   *
   * Pure (no I/O) on the runtimeSessionId branch: a tampered or absent
   * id falls through to `buildCopilotLaunchCommand` with a `null` id,
   * producing a fresh-launch form (no `--session-id`). The trust write
   * still runs; that is not a security concern because workspaceDir is
   * controlled by the caller (server, not user input).
   */
  async buildInteractiveLaunch(
    runtimeSessionId: string | null,
    opts: BuildInteractiveLaunchOpts,
  ): Promise<LaunchCommand> {
    if (opts.remote === true && this.capabilities.remoteSession !== true) {
      // Defensive: shouldn't fire because we set the capability above,
      // but the cross-runtime contract requires runtimes to refuse
      // unsupported flags rather than silently dropping them.
      throw new RuntimeDoesNotSupportRemoteError(this.kind);
    }
    await ensureDirTrusted(opts.workspaceDir, this.copilotConfigPath);
    // Pass the id through the validator so a tampered persisted record
    // can't smuggle shell metacharacters into the displayed
    // `--session-id=<id>` string.
    const id = safeCopilotId(runtimeSessionId);
    const cmd = buildCopilotLaunchCommand(id, opts);
    // Runtime owns the cross-cutting env base (`GLYPH_SERVER`,
    // `GLYPH_SHARED_DIR`, ...). T1 managers layer their own
    // work-context env on top of what we return here. We do NOT
    // honour `subprocessEnvScrub` on this path: interactive launches
    // hand off to a user shell which inherits the parent env
    // wholesale, and `cmd /k` / pwsh `$env:` prefixes can only SET
    // values, not unset them. The base is string-only by
    // `CopilotRuntimeConfig` contract.
    //
    // Spread `cmd.env` first so any env contributed by the inner
    // launch builder is preserved. Base overrides on key collision
    // because the runtime is the canonical owner of the cross-cutting
    // keys.
    return { ...cmd, env: { ...cmd.env, ...this.subprocessEnvBase } };
  }

  async readMetadata(runtimeSessionId: string): Promise<RuntimeSessionMetadata | null> {
    const id = safeCopilotId(runtimeSessionId);
    if (id === null) {
      // Malformed id: no copilot state to read. Defensive — defends
      // against tampered persisted state the same way the other
      // observability methods do.
      return null;
    }
    try {
      const meta = await readCopilotWorkspaceYaml(this.copilotStateDir, id);
      if (meta === null) return null;
      return {
        title: meta.title,
        userTitled: meta.userTitled,
        lastActiveAt: meta.lastActiveAt,
      };
    } catch (err) {
      throw new RuntimeReadMetadataFailed(this.kind, id, err as Error);
    }
  }

  async deleteState(runtimeSessionId: string): Promise<void> {
    const id = safeCopilotId(runtimeSessionId);
    if (id === null) return;
    // Drop in-memory buffer FIRST so any in-flight readActivity returns
    // null promptly. (Best-effort: the map is process-local and not
    // shared across instances; recoverOrphaned-style multi-instance
    // setups are out of scope here.)
    this.sessionBuffers.delete(id);
    const dir = path.join(this.copilotStateDir, id);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      throw new RuntimeStateDeletionFailed(this.kind, id, err as Error);
    }
  }

  /**
   * Spawn copilot non-interactively against `opts.workdir` to consume
   * `opts.prompt` unattended. Delegates to {@link launchCopilotHeadless}
   * (SDK-backed). The returned {@link RuntimeHandle} carries the
   * SDK-minted session id (so callers can persist it for later
   * inspection / readActivity / deleteState) and a `sessionDir` Promise
   * pointing at `<copilotStateDir>/<sessionId>/` (where the SDK's CLI
   * server writes its `events.jsonl` — kept for recoverOrphaned and
   * external tooling, not used on the hot path).
   */
  async launchHeadless(opts: LaunchHeadlessOpts): Promise<RuntimeHandle> {
    // Merge the runtime-owned env base with the caller's per-launch
    // additions. Caller env wins on key collision. Then translate
    // `subprocessEnvScrub` into `undefined` overrides for `mergeEnv`
    // (in launch-headless.ts) — but only for keys the caller hasn't
    // explicitly set, so a caller can still re-introduce a scrubbed
    // key intentionally if they need to.
    const mergedEnv: NodeJS.ProcessEnv = { ...this.subprocessEnvBase, ...opts.subprocessEnv };
    for (const key of this.subprocessEnvScrub) {
      if (!(key in mergedEnv)) mergedEnv[key] = undefined;
    }
    return launchCopilotHeadless(
      {
        workdir: opts.workdir,
        agent: opts.agent,
        catalog: opts.catalog,
        prompt: opts.prompt,
        workspaceDir: opts.workspaceDir,
        subprocessEnv: mergedEnv,
      },
      {
        copilotStateDir: this.copilotStateDir,
        sharedDir: this.sharedDir,
        registerSession: (sessionId, buffer) => {
          this.sessionBuffers.set(sessionId, buffer);
        },
        ...this.headlessDeps,
      },
    );
  }

  /**
   * Read + parse + derive — end-to-end. Reads `events.jsonl` from
   * `<copilotStateDir>/<runtimeSessionId>/`, lifts to ActivityItem[],
   * picks the headline result. Returns `null` if the file isn't on
   * disk yet (the conversation hasn't emitted its first event).
   *
   * The runtime owns the path discovery so consumers (server route,
   * dashboard) never see Copilot's internal `events.jsonl` shape or
   * its `~/.copilot/session-state/` layout.
   *
   * Two safety bounds:
   *   - **Raw read cap** (4 MB by default): if `events.jsonl` exceeds
   *     this, we read only the trailing N bytes and surface a
   *     `truncated.size_limit` marker. Prevents OOM / event-loop
   *     stalls when the agent has been chatty (extreme case observed:
   *     hundreds of MB after a long autonomous run).
   *   - **Per-page limit** (server-enforced via `opts.limit`): the
   *     runtime returns at most that many items.
   *
   * Pagination model (caller-driven, mutually exclusive):
   *   - Neither `before` nor `after` set → tail: latest `limit`
   *     items overall. GUI initial loads use this; the user lands at
   *     the most recent activity without paging through history.
   *   - `after = N` → forward: items with `seq > N`, oldest-first.
   *     Used by SSE polling and by callers walking head-to-tail.
   *   - `before = N` → backward: items with `seq < N`, returns the
   *     `limit` items immediately preceding the cut, still sorted by
   *     `seq` ASC. Used by GUI consumers loading older history when
   *     the user scrolls up past the initial tail-window.
   *   - Both → `RuntimeReadActivityInvalidArgs`. The route layer
   *     should reject before calling the runtime; this is a
   *     defensive guard against in-process callers bypassing the
   *     route.
   *
   * Items are sequenced 0..N-1 across the WHOLE log (not just the
   * returned page) — `seq` is the canonical pagination cursor and
   * matches what `streamActivity` would yield for live tail. Callers
   * derive `hasOlder` / `hasNewer` from the page window
   * (`activity[0].seq > 0`, `activity[last].seq < totalItems - 1`).
   */
  async readActivity(
    runtimeSessionId: string,
    opts: ReadActivityOpts = {},
  ): Promise<ActivityResult | null> {
    if (opts.before !== undefined && opts.after !== undefined) {
      throw new RuntimeReadActivityInvalidArgs(
        "readActivity: `before` and `after` are mutually exclusive",
      );
    }
    const id = safeCopilotId(runtimeSessionId);
    if (id === null) return null;

    // Hot path: SDK-backed session has an in-memory buffer populated
    // by `launchCopilotHeadless`. Serialize the buffer back to JSONL
    // and reuse the existing parser so the activity item shape
    // remains identical to the disk-read path (no duplicate parser
    // to maintain).
    //
    // Fall through to disk read when no buffer is present — this
    // covers (a) sessions that finished + were dropped from the map
    // (rare; we keep buffers until deleteState), and (b) recovered
    // orphan tasks after a server restart wiped the map.
    let raw: string | null = null;
    let truncated: TruncationInfo | undefined;
    const buffer = this.sessionBuffers.get(id);
    if (buffer !== undefined) {
      raw = serializeEventBuffer(buffer);
    } else {
      const eventsPath = path.join(this.copilotStateDir, id, "events.jsonl");
      try {
        const st = await stat(eventsPath);
        if (st.size > COPILOT_RAW_READ_CAP_BYTES) {
          // Tail-read: open + position to the last N bytes. We may slice
          // the first partial line after the cut; the parser drops it
          // silently (malformed JSON line) and the truncated marker
          // tells the consumer items were dropped.
          const fh = await open(eventsPath, "r");
          try {
            const buf = Buffer.alloc(COPILOT_RAW_READ_CAP_BYTES);
            await fh.read(buf, 0, COPILOT_RAW_READ_CAP_BYTES, st.size - COPILOT_RAW_READ_CAP_BYTES);
            raw = buf.toString("utf8");
            // Drop the (probably partial) first line.
            const firstNewline = raw.indexOf("\n");
            if (firstNewline > 0) raw = raw.slice(firstNewline + 1);
          } finally {
            await fh.close();
          }
          truncated = {
            reason: "size_limit",
            droppedBytes: st.size - COPILOT_RAW_READ_CAP_BYTES,
            hint: `events.jsonl is ${st.size} bytes; read last ${COPILOT_RAW_READ_CAP_BYTES} bytes only. Use task summary endpoint for high-level view.`,
          };
        } else {
          raw = await readFile(eventsPath, "utf8");
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw err;
      }
    }

    const allItems = parseCopilotActivity(raw);
    const totalItems = allItems.length;
    const result = deriveCopilotResult(raw);

    // Apply the pagination window per the model documented above.
    const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : undefined;
    let filtered: ActivityItem[];
    let pageTruncated: TruncationInfo | undefined;
    if (opts.after !== undefined) {
      // Forward: items strictly after `after`, oldest-first, capped at `limit`.
      const window = allItems.filter((i) => i.seq > (opts.after as number));
      if (limit !== undefined && window.length > limit) {
        filtered = window.slice(0, limit);
        pageTruncated = {
          reason: "page_limit",
          hint: `Showed ${limit} items after seq ${opts.after}; ${window.length - limit} more available — request again with after=${filtered[filtered.length - 1]?.seq}.`,
        };
      } else {
        filtered = window;
      }
    } else if (opts.before !== undefined) {
      // Backward: items strictly before `before`, return the `limit`
      // immediately preceding the cut (i.e., the latest below `before`),
      // still ASC-sorted for caller convenience.
      const window = allItems.filter((i) => i.seq < (opts.before as number));
      if (limit !== undefined && window.length > limit) {
        filtered = window.slice(window.length - limit);
        pageTruncated = {
          reason: "page_limit",
          hint: `Showed ${limit} items before seq ${opts.before}; ${window.length - limit} more available — request again with before=${filtered[0]?.seq}.`,
        };
      } else {
        filtered = window;
      }
    } else {
      // Tail: latest `limit` items. No `limit` set → return everything
      // (CLI default for "give me the whole log").
      if (limit !== undefined && allItems.length > limit) {
        filtered = allItems.slice(allItems.length - limit);
        pageTruncated = {
          reason: "page_limit",
          hint: `Showed last ${limit} of ${allItems.length} items — request again with before=${filtered[0]?.seq} to read older history.`,
        };
      } else {
        filtered = allItems;
      }
    }

    return {
      activity: filtered,
      result,
      totalItems,
      // size_limit (raw-read tail) takes precedence over page_limit
      // when both apply.
      ...(truncated !== undefined
        ? { truncated }
        : pageTruncated !== undefined
          ? { truncated: pageTruncated }
          : {}),
    };
  }

  /**
   * The latest agent-produced utterance for this session. For Copilot
   * the "agent" is its assistant messages — tool calls, thinking
   * traces, system events, and user prompts are all skipped. Reuses
   * {@link readActivity} so the in-memory buffer vs disk fallback,
   * size-cap handling, and parser logic stay in one place. Returns
   * `null` when there is no recorded session for the id, or when the
   * recorded session has no assistant items yet (the run just started,
   * agent only emitted tool calls so far, …).
   */
  async getLastAgentActivity(runtimeSessionId: string): Promise<AgentActivity | null> {
    const result = await this.readActivity(runtimeSessionId);
    if (result === null) return null;
    for (let i = result.activity.length - 1; i >= 0; i--) {
      const item = result.activity[i];
      if (item !== undefined && item.kind === "assistant") {
        return { text: item.text, timestamp: item.timestamp };
      }
    }
    return null;
  }

  /**
   * Live-tail variant. Yields each new {@link ActivityItem} as the
   * underlying SDK session emits it (or, for orphan-recovered sessions
   * with no in-memory buffer, by tailing `events.jsonl` from disk).
   * Yields nothing on already-recorded content — call {@link readActivity}
   * for that, then subscribe to this for the live tail (the dashboard
   * pattern).
   *
   * Cleanup: stops on `opts.signal` abort or when the source ends
   * (buffer's `finished=true` flag set; or the disk file disappears).
   */
  async *streamActivity(
    runtimeSessionId: string,
    opts: StreamActivityOpts = {},
  ): AsyncIterable<ActivityItem> {
    const id = safeCopilotId(runtimeSessionId);
    if (id === null) return;

    // Hot path: if we have an in-memory buffer, subscribe to it
    // directly. New SDK events fan out through the buffer's
    // `subscribers` Set and we yield each event as ActivityItem(s).
    const memBuffer = this.sessionBuffers.get(id);
    if (memBuffer !== undefined) {
      yield* streamFromBuffer(memBuffer, opts);
      return;
    }

    // Fallback: orphan-recovered session — tail events.jsonl from disk.
    yield* streamFromDisk(this.copilotStateDir, id, opts);
  }
}
