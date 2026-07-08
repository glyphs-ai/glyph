import { spawn } from "node:child_process";
import type { RuntimeHeadlessLaunchFailed } from "../errors.js";
import type { RuntimeExit, RuntimeHandle } from "../types.js";

/**
 * Opencode data directory — where the CLI writes per-session state.
 * Matches the XDG data-home convention opencode uses on Linux/macOS.
 * Tests may override via {@link LaunchOpencodeHeadlessOpts.opencodeDataDir}.
 */
export const DEFAULT_OPENCODE_DATA_DIR = (() => {
  if (process.env.XDG_DATA_HOME) {
    return `${process.env.XDG_DATA_HOME}/opencode`;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home}/.local/share/opencode`;
})();

export interface LaunchOpencodeHeadlessOpts {
  /** Absolute path of the provisioned workdir; becomes the subprocess cwd. */
  readonly workdir: string;
  /** Prompt text sent to the `opencode run` command as a positional arg. */
  readonly prompt: string;
  /** Extra environment variables merged into the subprocess env. */
  readonly subprocessEnv?: NodeJS.ProcessEnv;
}

export interface LaunchOpencodeHeadlessDeps {
  /**
   * opencode data directory override. Production callers omit this
   * (falls back to {@link DEFAULT_OPENCODE_DATA_DIR}). Tests pass a
   * tmp dir so no real state is written.
   */
  readonly opencodeDataDir?: string;
  /**
   * Spawn seam — injects a fake `spawn` for unit tests that must not
   * actually launch the CLI. Production callers omit this.
   */
  readonly spawnProcess?: typeof spawn;
}

/**
 * Spawn `opencode run <prompt> --auto --format json` non-interactively and
 * return a {@link RuntimeHandle}. The session ID is discovered by parsing
 * the `sessionID` field from the first JSON event line on stdout — opencode
 * streams NDJSON events (one per line) when `--format json` is set.
 *
 * Timeout: if no JSON event containing a `sessionID` arrives within 10 s,
 * `runtimeSessionId` is left `undefined` and the handle is returned anyway.
 * The task manager can still observe `exit` and call `readMetadata` later.
 *
 * `kill()` sends SIGTERM to the opencode process (graceful shutdown —
 * opencode finishes the current tool invocation before stopping).
 */
export async function launchOpencodeHeadless(
  opts: LaunchOpencodeHeadlessOpts,
  deps: LaunchOpencodeHeadlessDeps = {},
): Promise<RuntimeHandle | { type: "RuntimeHeadlessLaunchFailed"; cause: unknown }> {
  const dataDir = deps.opencodeDataDir ?? DEFAULT_OPENCODE_DATA_DIR;
  const spawnFn = deps.spawnProcess ?? spawn;

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawnFn("opencode", ["run", opts.prompt, "--auto", "--format", "json"], {
      cwd: opts.workdir,
      env: mergeEnv(process.env, opts.subprocessEnv),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    const err: RuntimeHeadlessLaunchFailed = { type: "RuntimeHeadlessLaunchFailed", cause };
    return err;
  }

  // If spawn fails synchronously (e.g. ENOENT — opencode not installed),
  // the error surfaces via the 'error' event on the returned child-process.
  // Surface it as the typed error atom so the caller stays on the Result rail.
  const spawnErrorPromise = new Promise<RuntimeHeadlessLaunchFailed | null>((resolve) => {
    proc.once("error", (cause: Error) => resolve({ type: "RuntimeHeadlessLaunchFailed", cause }));
    // Once stdout opens we know the spawn succeeded; clear the error latch.
    proc.stdout?.once("data", () => resolve(null));
    proc.stdout?.once("close", () => resolve(null));
  });

  // Parse the session ID from the first JSON event that carries it.
  // opencode emits: `{"type":"...","timestamp":...,"sessionID":"ses_<ulid>",...}`
  let sessionId: string | undefined;
  let sessionIdResolved = false;
  let resolveSessionId: (id: string | undefined) => void;
  const sessionIdPromise = new Promise<string | undefined>((resolve) => {
    resolveSessionId = resolve;
  });

  let stdoutBuffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    if (sessionIdResolved) return;
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer.
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
          sessionId = event.sessionID;
          sessionIdResolved = true;
          resolveSessionId(sessionId);
          return;
        }
      } catch {
        // Skip non-JSON lines (e.g. startup banner before JSON begins).
      }
    }
  });

  proc.stdout?.on("close", () => {
    if (!sessionIdResolved) {
      sessionIdResolved = true;
      resolveSessionId(undefined);
    }
  });

  // Race: session ID vs spawn error vs 10 s timeout.
  const SESSION_ID_TIMEOUT_MS = 10_000;
  const discovered = await Promise.race([
    sessionIdPromise,
    spawnErrorPromise,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), SESSION_ID_TIMEOUT_MS),
    ),
  ]);

  if (discovered !== null && typeof discovered === "object" && "type" in discovered) {
    // Spawn error: proc emitted 'error' before any stdout.
    return discovered as RuntimeHeadlessLaunchFailed;
  }

  // Session ID may be undefined if the CLI exited before emitting a session
  // event (rare, e.g. bad credentials). Callers tolerate `undefined` here.
  const resolvedSessionId = sessionId;

  const exitPromise = new Promise<RuntimeExit>((resolve) => {
    proc.on("close", (code, signal) => {
      resolve({
        code: code ?? null,
        signal: (signal as NodeJS.Signals | null) ?? null,
      });
    });
  });

  const handle: RuntimeHandle = {
    // sessionDir points at opencode's per-session state directory.
    // The path is deterministic once we know the session ID; it resolves
    // asynchronously because the ID is discovered after spawn.
    sessionDir: sessionIdPromise.then((id) =>
      id !== undefined ? `${dataDir}/sessions/${id}` : dataDir,
    ),
    exit: exitPromise,
    kill() {
      proc.kill("SIGTERM");
    },
  };
  // runtimeSessionId is optional on RuntimeHandle; only set it when known
  // to satisfy exactOptionalPropertyTypes (assigning undefined is a type error).
  if (resolvedSessionId !== undefined) {
    (handle as { runtimeSessionId?: string }).runtimeSessionId = resolvedSessionId;
  }
  return handle;
}

/** Merge env bags, dropping keys whose value is `undefined`. */
function mergeEnv(base: NodeJS.ProcessEnv, overlay?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!overlay) return base;
  const result: NodeJS.ProcessEnv = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined) {
      delete result[k];
    } else {
      result[k] = v;
    }
  }
  return result;
}
