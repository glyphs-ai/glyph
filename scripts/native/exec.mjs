/**
 * Thin promisified wrappers around `child_process.execFile` used by
 * every native-build orchestrator script. The goal is uniform error
 * surfacing: every failed command prints `stdout + stderr + message`
 * before the script exits, instead of dropping that context on the
 * floor like raw `execFile` does.
 */

import { execFile } from "node:child_process";
import { basename, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { repoRoot } from "./paths.mjs";

const execFileAsync = promisify(execFile);

/**
 * Wrap a command so Windows runs `.cmd` / `.bat` shims through cmd.exe
 * the same way npm-installed bin shims expect. POSIX path is a no-op.
 * Glyph's PR1 native build only targets linux-x64, but `postject.cmd`
 * et al. could still get invoked when an operator runs scripts locally
 * on Windows; this keeps the dev path predictable.
 */
export function commandForExecFile(command, args, platform = process.platform, env = process.env) {
  if (platform !== "win32" || !/\.(?:bat|cmd)$/i.test(command)) {
    return { command, args };
  }
  const shellCommand = [command, ...args]
    .map((arg) => `"${String(arg).replaceAll('"', '""')}"`)
    .join(" ");
  return {
    command: env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${shellCommand}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}

export async function run(command, args, options = {}) {
  const { captureStdout, ...rest } = options;
  const exec = commandForExecFile(command, args);
  try {
    const { stdout, stderr } = await execFileAsync(exec.command, exec.args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 64,
      ...exec.options,
      ...rest,
    });
    if (!captureStdout && stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    return { stdout, stderr };
  } catch (error) {
    const details = [error.stdout?.trim(), error.stderr?.trim(), error.message]
      .filter(Boolean)
      .join("\n");
    fail(`Command failed: ${basename(command)} ${args.join(" ")}\n${details}`);
  }
}

export async function tryRun(command, args, options = {}) {
  const exec = commandForExecFile(command, args);
  try {
    await execFileAsync(exec.command, exec.args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 64,
      ...exec.options,
      ...options,
    });
  } catch (error) {
    const details = [error.stdout?.trim(), error.stderr?.trim(), error.message]
      .filter(Boolean)
      .join("\n");
    console.warn(`Warning: ${basename(command)} ${args.join(" ")} failed.\n${details}`);
  }
}

/**
 * True when `moduleUrl` (typically `import.meta.url`) is the Node
 * entry point. Cross-platform replacement for the brittle
 * `import.meta.url === \`file://${process.argv[1]}\`` idiom that
 * breaks on Windows (drive letters + backslashes) and on POSIX
 * (`file://` vs `file:///`).
 */
export function isEntry(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return resolvePath(fileURLToPath(moduleUrl)) === resolvePath(process.argv[1]);
  } catch {
    return false;
  }
}
