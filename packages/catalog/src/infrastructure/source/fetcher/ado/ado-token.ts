import { spawn } from "node:child_process";

/**
 * Default-token resolution for `AzureDevOpsFetcher`.
 *
 * Two-tier fallback chain: explicit env var first, then `git` credential
 * helper:
 *
 *   1. `process.env.AZURE_DEVOPS_EXT_PAT ?? process.env.AZURE_DEVOPS_PAT
 *      ?? process.env.SYSTEM_ACCESSTOKEN` — explicit env always wins.
 *      Returned with `{ source: "env" }` so the caller can skip the
 *      `approve`/`reject` round-trip (env tokens have no GCM entry).
 *   2. `git -c credential.useHttpPath=true credential fill` — invoked once
 *      per `(org, repo)` per {@link CACHE_TTL_MS}. A silent peek checks for
 *      cached credentials before the interactive fill opens a sign-in window.
 *   3. `null` — caller emits an anonymous request.
 *
 * The `(org, repo)` cache avoids repeated `git` spawns during dependency-tree
 * fetches. `PENDING` collapses concurrent cold-cache resolves to one shared
 * credential fill. Git failures fall through to anonymous; the HTTP layer then
 * reports any 401/403 from Azure DevOps.
 *
 * Non-interactive mode is explicit (`CI=true` or `GLYPH_NON_INTERACTIVE=1`).
 * Other environments attempt interactive fill with a 120s bound.
 */

/**
 * Outcome of a successful credential resolve. `source: "env"` means the
 * token came from a supported environment variable and has no GCM entry.
 * `source: "git-credential"` means the token came from `git credential fill`;
 * the caller runs `approve` on 2xx and `reject` plus
 * {@link invalidateAdoTokenCache} on 401/403.
 */
export type ResolvedAdoToken =
  | { readonly source: "env"; readonly token: string; readonly username?: undefined }
  | { readonly source: "git-credential"; readonly token: string; readonly username: string };

/** Raw `(username, password)` block parsed from `git credential fill`. */
export interface AdoCredential {
  readonly username: string;
  readonly password: string;
}

interface CacheEntry {
  readonly value: ResolvedAdoToken | null;
  readonly expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const PENDING = new Map<string, Promise<ResolvedAdoToken | null>>();
/**
 * Tracks `(org, repo)` pairs we've already logged an "env token in use"
 * notice for. Cleared in {@link _resetAdoTokenCache} for isolated tests.
 */
const ENV_LOG_NOTICE_EMITTED = new Set<string>();
const CACHE_TTL_MS = 60_000;
/**
 * Silent peek expects a warm-cache hit or fast non-zero exit; 5s bounds a
 * stalled credential helper.
 */
const SPAWN_TIMEOUT_MS_SILENT = 5_000;
/**
 * Interactive fill spawns a real GCM popup; a user typing MFA codes /
 * approving a notification can take up to 120s before falling through to
 * anonymous.
 */
const SPAWN_TIMEOUT_MS_INTERACTIVE = 120_000;
/**
 * `git credential approve|reject` are non-interactive housekeeping calls
 * with a 5s timeout.
 */
const SPAWN_TIMEOUT_MS_CONFIRM = 5_000;

/**
 * `credential.useHttpPath=true` makes GCM include request `path=` in its
 * credential lookup key.
 *
 * The silent-peek variant also uses `credential.interactive=false` and
 * `GCM_INTERACTIVE=Never`.
 */
const BASE_GIT_ARGS = ["-c", "credential.useHttpPath=true"] as const;
const SILENT_GIT_ARGS = ["-c", "credential.interactive=false"] as const;
const SILENT_ENV: Readonly<Record<string, string>> = { GCM_INTERACTIVE: "Never" };

interface FillOptions {
  /** When true, suppress the interactive popup when no cached credential exists. */
  readonly silent?: boolean;
}

/**
 * Spawn `git ... credential fill`, write the per-`(org, repo)` request to
 * stdin, and parse `username=` / `password=` from stdout. Returns `null`
 * (NEVER throws) on any failure mode (spawn ENOENT, non-zero exit,
 * timeout, missing/empty `password=`). The `password=` is treated as
 * opaque.
 *
 * `stdio[2]` is `"ignore"` so GCM stderr never reaches error messages.
 * `stdio[0]` is `"pipe"` so the request body can be written to stdin.
 */
function runGitCredentialFill(
  org: string,
  repo: string,
  opts: FillOptions = {},
): Promise<AdoCredential | null> {
  return new Promise<AdoCredential | null>((resolve) => {
    let settled = false;
    const settle = (v: AdoCredential | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const gitArgs: string[] = [...BASE_GIT_ARGS];
    if (opts.silent) gitArgs.push(...SILENT_GIT_ARGS);
    gitArgs.push("credential", "fill");

    // The silent variant sets both the git config flag and environment
    // variable. The non-silent path inherits the parent environment.
    const spawnOpts: Parameters<typeof spawn>[2] = {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    };
    if (opts.silent) {
      spawnOpts.env = { ...process.env, ...SILENT_ENV };
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", gitArgs, spawnOpts);
    } catch {
      settle(null);
      return;
    }

    // Silent peek has a 5s ceiling; interactive fill allows up to 120s for MFA.
    const timeoutMs = opts.silent ? SPAWN_TIMEOUT_MS_SILENT : SPAWN_TIMEOUT_MS_INTERACTIVE;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Child may already have exited between the timer firing and
        // reaching this line. The `close` listener will settle.
      }
      settle(null);
    }, timeoutMs);

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      settle(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle(null);
        return;
      }
      // `git credential fill` emits one `key=value` per line, terminated
      // by a blank line. We care about `username=` (echoed for GCM's
      // approve/reject round-trip) and `password=` (the actual token).
      let username: string | null = null;
      let password: string | null = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith("username=")) username = line.slice("username=".length);
        else if (line.startsWith("password=")) password = line.slice("password=".length);
      }
      if (password === null || password.length === 0) {
        settle(null);
        return;
      }
      settle({ username: username ?? "", password });
    });

    const stdin = child.stdin;
    if (stdin === null) {
      // Spawned without a writable stdin — the `close` listener will
      // settle when the child exits.
      return;
    }
    // `path=<org>/_git/<repo>` is REQUIRED for GCM to resolve
    // dev.azure.com credentials; without it GCM throws "Cannot determine
    // the organization name".
    const request = `protocol=https\nhost=dev.azure.com\npath=${org}/_git/${repo}\n\n`;
    try {
      stdin.write(request, () => {
        try {
          stdin.end();
        } catch {
          // ignore — close listener handles settlement
        }
      });
    } catch {
      // stdin may have closed before the write landed; settle on close.
    }
  });
}

/**
 * Public wrapper for the interactive variant of `git credential fill`.
 * Kept exported (and structurally distinct from the silent peek) so tests
 * can exercise the spawn/parse contract end-to-end without depending on
 * the resolver's UX-detection logic.
 *
 * Returns `{ username, password } | null`. The username is essential for
 * the {@link gitCredentialApprove} / {@link gitCredentialReject}
 * round-trip — GCM keys per-credential entries on `(protocol, host,
 * path, username)` and an approve/reject without the matching username
 * is a silent no-op.
 */
export async function tryGitCredentialFill(
  org: string,
  repo: string,
): Promise<AdoCredential | null> {
  return runGitCredentialFill(org, repo, { silent: false });
}

/**
 * Run `git -c credential.useHttpPath=true credential <approve|reject>`,
 * echoing the full request block (including `username=` and `password=`)
 * back to GCM so it can confirm or discard its cached credential.
 *
 * MUST NOT throw — these are best-effort hygiene calls that the main
 * fetcher path fires-and-forgets after the HTTP response has already
 * resolved. Any internal failure is surfaced via `process.emitWarning`
 * with the matching `GLYPH_GCM_*` code and swallowed.
 */
function runGitCredentialConfirm(
  action: "approve" | "reject",
  org: string,
  repo: string,
  username: string,
  password: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const warnCode = action === "approve" ? "GLYPH_GCM_APPROVE_FAILED" : "GLYPH_GCM_REJECT_FAILED";
    const settle = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const warn = (msg: string): void => {
      try {
        process.emitWarning(msg, { code: warnCode });
      } catch {
        // emitWarning is defensive — never let a logger problem propagate.
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", [...BASE_GIT_ARGS, "credential", action], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch (cause) {
      warn(`git credential ${action} spawn failed: ${(cause as Error).message}`);
      settle();
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      warn(`git credential ${action} timed out after ${SPAWN_TIMEOUT_MS_CONFIRM}ms`);
      settle();
    }, SPAWN_TIMEOUT_MS_CONFIRM);

    child.on("error", (cause: Error) => {
      clearTimeout(timer);
      warn(`git credential ${action} errored: ${cause.message}`);
      settle();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        warn(`git credential ${action} exited with code ${code ?? "unknown"}`);
      }
      settle();
    });

    const stdin = child.stdin;
    if (stdin === null) {
      warn(`git credential ${action} spawn produced no writable stdin`);
      return;
    }
    // Echo back the full request block. GCM uses (protocol, host, path,
    // username) as the cache key; omitting the username makes the
    // approve/reject a no-op against the wrong cache entry. The blank
    // line at the end terminates the request.
    const request =
      `protocol=https\nhost=dev.azure.com\npath=${org}/_git/${repo}\n` +
      `username=${username}\npassword=${password}\n\n`;
    try {
      stdin.write(request, () => {
        try {
          stdin.end();
        } catch {
          // ignore
        }
      });
    } catch (cause) {
      warn(`git credential ${action} stdin write failed: ${(cause as Error).message}`);
    }
  });
}

/**
 * Confirm to GCM that the credential returned by `fill` was accepted by the
 * server. Run after a 2xx response. NEVER throws — any failure is reported via `process.emitWarning({ code:
 * "GLYPH_GCM_APPROVE_FAILED" })` and swallowed.
 *
 * GCM persists approved credentials to OS-level credential storage.
 */
export async function gitCredentialApprove(
  org: string,
  repo: string,
  username: string,
  password: string,
): Promise<void> {
  await runGitCredentialConfirm("approve", org, repo, username, password);
}

/**
 * Tell GCM that the credential returned by `fill` was rejected by the server
 * (typically a 401/403 response). Forces GCM to discard the stale entry.
 * NEVER throws — any failure is reported via
 * `process.emitWarning({ code: "GLYPH_GCM_REJECT_FAILED" })` and swallowed.
 *
 * Pair with {@link invalidateAdoTokenCache} to clear the in-process cache.
 */
export async function gitCredentialReject(
  org: string,
  repo: string,
  username: string,
  password: string,
): Promise<void> {
  await runGitCredentialConfirm("reject", org, repo, username, password);
}

/**
 * Drop the in-process 60s cache entry for a single `(org, repo)` pair.
 * Call alongside {@link gitCredentialReject} on a 401/403 response.
 */
export function invalidateAdoTokenCache(org: string, repo: string): void {
  CACHE.delete(`${org}/${repo}`);
}

function readEnvToken(): string | undefined {
  return (
    process.env.AZURE_DEVOPS_EXT_PAT ??
    process.env.AZURE_DEVOPS_PAT ??
    process.env.SYSTEM_ACCESSTOKEN
  );
}

/**
 * Detect explicit non-interactive environments where sign-in popups are
 * disabled. Returns `true` on:
 *
 *   - `process.env.CI === "true"`
 *   - `process.env.GLYPH_NON_INTERACTIVE === "1"`
 */
function isNonInteractive(): boolean {
  // GCM popup availability depends on the OS desktop session, not on the
  // parent process TTY. Let GCM handle display detection unless the user or
  // runtime explicitly opts out.
  if (process.env.GLYPH_NON_INTERACTIVE === "1") return true;
  if (process.env.CI === "true") return true;
  return false;
}

/**
 * The escape-hatch message used by the non-interactive guard. Includes
 * both env-var and credential-cache remediation.
 */
function escapeHatchMessage(org: string, repo: string): string {
  return (
    `ADO authentication required for dev.azure.com/${org}/${repo}.\n` +
    `  Option 1 (CI / non-interactive): set environment variable AZURE_DEVOPS_PAT\n` +
    `    with a Personal Access Token from\n` +
    `    https://dev.azure.com/${org}/_usersSettings/tokens\n` +
    `  Option 2 (interactive): run any git command against the repo first\n` +
    `    (e.g. git ls-remote https://dev.azure.com/${org}/_git/${repo})\n` +
    `    to seed the credential cache, then retry.`
  );
}

/**
 * Core silent-peek → maybe-interactive flow. Throws an `Error`
 * only when explicit non-interactive mode has no cached credential and no
 * env-var fallback. Returns `null` when interactive fill fails or is canceled.
 */
async function doResolveWithGcm(org: string, repo: string): Promise<ResolvedAdoToken | null> {
  // Silent peek succeeds quietly with a cached credential and fails fast
  // before an interactive prompt.
  const silent = await runGitCredentialFill(org, repo, { silent: true });
  if (silent !== null) {
    return { source: "git-credential", token: silent.password, username: silent.username };
  }
  // Silent miss requires interactive fill unless explicit non-interactive
  // mode is set.
  if (isNonInteractive()) {
    const uri = `https://dev.azure.com/${org}/_git/${repo}`;
    throw new Error(`${uri}: ${escapeHatchMessage(org, repo)}`);
  }
  // Warn before opening the Microsoft sign-in window.
  process.stderr.write(
    `[glyph] Authenticating to dev.azure.com/${org} — a Microsoft sign-in window may appear...\n`,
  );
  const interactive = await runGitCredentialFill(org, repo, { silent: false });
  if (interactive === null) return null;
  return {
    source: "git-credential",
    token: interactive.password,
    username: interactive.username,
  };
}

/**
 * Resolve the default Azure DevOps Services credential for `(org, repo)`.
 * Implements the full chain documented at the top of this file:
 * env-var → silent peek → (TTY ? interactive fill : escape-hatch throw).
 *
 * The env-var check is NOT cached: each call re-reads `process.env` so
 * that a long-lived host process picks up a mid-run env mutation
 * immediately. Only the (relatively expensive) `git credential fill`
 * tier is cached.
 *
 * Concurrent callers for the same `(org, repo)` SHARE a single in-flight
 * Promise via the `PENDING` map. Without this, a tree-fan-out worker
 * pool would all hit the cold-cache resolve in parallel — each spawning
 * its own `git credential fill` — and trigger N parallel GCM popups.
 * Combined with the explicit pre-warm in
 * {@link AzureDevOpsFetcher.fetchTree}, this guarantees at most one
 * popup per tree install.
 */
export async function resolveDefaultAdoToken(
  org: string,
  repo: string,
): Promise<ResolvedAdoToken | null> {
  const cacheKey = `${org}/${repo}`;

  const envToken = readEnvToken();
  if (envToken !== undefined) {
    // First-hit-only stderr notice so a long-running host process
    // (e.g. glyph server) doesn't silently keep using an env token
    // that the user thought they'd unset in their interactive shell.
    // The notice fires once per `(org, repo)` to avoid spamming
    // tree-fan-out installs.
    if (!ENV_LOG_NOTICE_EMITTED.has(cacheKey)) {
      ENV_LOG_NOTICE_EMITTED.add(cacheKey);
      process.stderr.write(
        `[glyph] using ADO token from environment (AZURE_DEVOPS_*_PAT / SYSTEM_ACCESSTOKEN) for dev.azure.com/${org}/${repo}\n`,
      );
    }
    return { source: "env", token: envToken };
  }

  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const inflight = PENDING.get(cacheKey);
  if (inflight) return inflight;

  // Snapshot the resolve in a single Promise that all concurrent callers
  // for this cacheKey share. Cache on success, including a `null` result;
  // negative caching is critical so a workspace with no GCM doesn't spawn
  // `git` once per item across a deep dep graph. Do NOT cache on throw
  // (we want the next call to re-attempt rather than re-throw a stale
  // error). The `finally` clears PENDING regardless so a thrown resolve
  // doesn't permanently poison the slot.
  const promise = (async (): Promise<ResolvedAdoToken | null> => {
    try {
      const result = await doResolveWithGcm(org, repo);
      CACHE.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    } finally {
      PENDING.delete(cacheKey);
    }
  })();

  PENDING.set(cacheKey, promise);
  return promise;
}

/**
 * Test-only: clear the per-(org, repo) cache AND the in-flight map
 * between cases. Not exported from the package index — tests reach into
 * this module directly, matching the `_resetGhTokenCache` pattern in
 * `gh-token.ts`.
 */
export function _resetAdoTokenCache(): void {
  CACHE.clear();
  PENDING.clear();
  ENV_LOG_NOTICE_EMITTED.clear();
}
