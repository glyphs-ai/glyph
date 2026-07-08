import { homedir } from "node:os";
import path from "node:path";
import { okAsync, ResultAsync } from "neverthrow";
import type {
  RuntimeHeadlessLaunchFailed,
  RuntimeLaunchFailed,
  RuntimeProvisionFailed,
  RuntimeStateDeletionFailed,
} from "../errors.js";
import type { PlaceholderContext } from "../placeholders.js";
import { SHARED_SUBDIR } from "../shared-dir.js";
import type {
  BuildInteractiveLaunchOpts,
  LaunchCommand,
  LaunchHeadlessOpts,
  Runtime,
  RuntimeHandle,
  RuntimeSessionMetadata,
} from "../types.js";
import { buildOpencodeLaunchCommand } from "./interactive-launch.js";
import { type LaunchOpencodeHeadlessDeps, launchOpencodeHeadless } from "./launch-headless.js";
import { provisionOpencodeWorkdir } from "./provision.js";

const DEFAULT_SHARED_DIR = path.join(homedir(), ".glyph", SHARED_SUBDIR);

export interface OpencodeRuntimeConfig {
  /**
   * Override the directory exposed to spec authors as `${sharedDir}` in
   * placeholder substitution. Defaults to `~/.glyph/shared`. Server
   * bootstrap normally derives this from `GLYPH_HOME` and passes it
   * explicitly so the value tracks any `GLYPH_HOME` override.
   */
  readonly sharedDir?: string;
  /**
   * Environment variables layered into every spawned subprocess and
   * into every returned `LaunchCommand.env`. The runtime owns this
   * because runtime is the entity that actually spawns / hands off
   * the agent process. T1 managers contribute only their own
   * work-context env (GLYPH_WORK_*, GLYPH_WORKSPACE*) on top.
   */
  readonly subprocessEnvBase?: Readonly<Record<string, string>>;
  /**
   * Env keys to delete from the inherited parent env on the headless
   * launch path. Translated into `undefined` overrides before passing
   * to `mergeEnv` inside {@link launchOpencodeHeadless}.
   */
  readonly subprocessEnvScrub?: readonly string[];
  /**
   * Optional injection of headless-launch dependencies. Production
   * callers leave this unset; tests pass a stub `spawnProcess` to avoid
   * actually launching the CLI.
   */
  readonly headlessDeps?: Partial<LaunchOpencodeHeadlessDeps>;
}

/**
 * The opencode adapter.
 *
 * opencode (https://opencode.ai) is a CLI-based AI coding tool that does not
 * provide an npm SDK for programmatic control. This adapter drives it purely
 * via the CLI:
 *
 *   ## Interactive mode (`opencode`)
 *   - {@link provision}: copy agent files into workdir and write `opencode.json`
 *     with any MCP server config, so the CLI picks them up on launch.
 *   - {@link buildInteractiveLaunch}: produce `opencode [--session <id>] --auto`
 *     to drop the user into the TUI in the provisioned workdir.
 *
 *   ## Non-interactive mode (`opencode run`)
 *   - {@link launchHeadless}: spawn `opencode run <prompt> --auto --format json`
 *     and capture the session ID from the NDJSON event stream on stdout.
 *
 * ## Session IDs
 *
 * opencode mints its own session IDs (`ses_<ulid>`) at run time — there is no
 * mechanism to pre-allocate one before the CLI starts. Therefore:
 *
 *   - {@link provision} always returns `null` for `runtimeSessionId`.
 *   - The session ID is discovered from the first JSON event on stdout during
 *     headless launches; for interactive launches it is discovered later by
 *     the manager calling {@link readMetadata} (not yet implemented; returns
 *     `null` for iteration 1).
 *
 * ## MCP config
 *
 * MCP servers are written to `opencode.json` in the workdir during provision.
 * opencode loads this as a project-level config when launched from that dir.
 * Glyph's catalog wire format (`{ type: "stdio", command, args, env }`) is
 * converted to opencode's local-server format
 * (`{ type: "local", command: [cmd, ...args], environment: env }`).
 */
export class OpencodeRuntime implements Runtime {
  readonly kind = "opencode";

  private readonly sharedDir: string;
  private readonly subprocessEnvBase: Readonly<Record<string, string>>;
  private readonly subprocessEnvScrub: readonly string[];
  private readonly headlessDeps: Partial<LaunchOpencodeHeadlessDeps>;

  constructor(opts: OpencodeRuntimeConfig = {}) {
    this.sharedDir = opts.sharedDir ?? DEFAULT_SHARED_DIR;
    this.subprocessEnvBase = opts.subprocessEnvBase ?? {};
    this.subprocessEnvScrub = opts.subprocessEnvScrub ?? [];
    this.headlessDeps = opts.headlessDeps ?? {};
  }

  provision(opts: {
    workdir: string;
    agent: import("../types.js").ResolvedAgent;
    catalog: import("../types.js").AgentContentSource;
    workspaceDir: string;
  }): ResultAsync<{ runtimeSessionId: null }, RuntimeProvisionFailed> {
    const placeholders: PlaceholderContext = {
      workspaceDir: opts.workspaceDir,
      sharedDir: this.sharedDir,
    };
    return ResultAsync.fromPromise(
      provisionOpencodeWorkdir(opts.workdir, opts.agent, opts.catalog, placeholders),
      (cause): RuntimeProvisionFailed => ({ type: "RuntimeProvisionFailed", cause }),
    ).map(() => ({ runtimeSessionId: null }));
  }

  buildInteractiveLaunch(
    runtimeSessionId: string | null,
    opts: BuildInteractiveLaunchOpts,
  ): ResultAsync<LaunchCommand, RuntimeLaunchFailed> {
    if (opts.remote === true) {
      return ResultAsync.fromPromise(
        Promise.reject(new Error(`runtime "${this.kind}" does not support remote sessions`)),
        (cause): RuntimeLaunchFailed => ({ type: "RuntimeLaunchFailed", cause }),
      );
    }
    const cmd = buildOpencodeLaunchCommand(runtimeSessionId, opts);
    return okAsync({ ...cmd, env: { ...this.subprocessEnvBase } });
  }

  launchHeadless(
    opts: LaunchHeadlessOpts,
  ): ResultAsync<RuntimeHandle, RuntimeHeadlessLaunchFailed> {
    const mergedEnv: NodeJS.ProcessEnv = { ...this.subprocessEnvBase, ...opts.subprocessEnv };
    for (const key of this.subprocessEnvScrub) {
      if (!(key in mergedEnv)) mergedEnv[key] = undefined;
    }
    return ResultAsync.fromSafePromise(
      launchOpencodeHeadless(
        {
          workdir: opts.workdir,
          prompt: opts.prompt,
          subprocessEnv: mergedEnv,
        },
        this.headlessDeps,
      ),
    ).andThen((result) => {
      if ("type" in result && result.type === "RuntimeHeadlessLaunchFailed") {
        return ResultAsync.fromPromise(
          Promise.reject((result as RuntimeHeadlessLaunchFailed).cause),
          (cause): RuntimeHeadlessLaunchFailed => ({ type: "RuntimeHeadlessLaunchFailed", cause }),
        );
      }
      return okAsync(result as RuntimeHandle);
    });
  }

  readMetadata(_runtimeSessionId: string): ResultAsync<RuntimeSessionMetadata | null, never> {
    // opencode session metadata reading is not yet implemented; callers
    // treat null as "no metadata available". A future iteration can
    // query the opencode HTTP API or parse its SQLite database.
    return okAsync(null);
  }

  deleteState(_runtimeSessionId: string): ResultAsync<void, RuntimeStateDeletionFailed> {
    // opencode session deletion via the CLI (`opencode session delete <id>`)
    // is not yet implemented in this adapter. Returning ok means the
    // T1 manager proceeds to purge its own local records regardless.
    // A future iteration can spawn `opencode session delete <id>` here.
    return okAsync(undefined);
  }
}
