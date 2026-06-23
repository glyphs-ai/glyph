/**
 * Error classes for `@glyphs-ai/terminal`.
 *
 * All four errors extend `Error` directly (no shared base class) because
 * terminal is a leaf infrastructure package — callers typically match on
 * the concrete class name rather than a base-class `instanceof` gate.
 *
 * Each error carries the `.name` string as a stable discriminator for
 * cross-realm matching (e.g. serialized through JSON in server error
 * responses).
 *
 * | Error                       | When thrown                                      |
 * | --------------------------- | ------------------------------------------------ |
 * | `InvalidLaunchCommandError` | Command fields contain control chars or invalid  |
 * |                             | env names — caller must fix input before retry.  |
 * | `NoTerminalFoundError`      | No supported terminal emulator was found on      |
 * |                             | PATH (Linux only — macOS/Windows always have     |
 * |                             | at least one launcher available).                |
 * | `TerminalSpawnFailedError`  | A chosen launcher was found but its spawn failed |
 * |                             | immediately (ENOENT, non-zero exit before the    |
 * |                             | observation window elapsed).                     |
 * | `UnsupportedPlatformError`  | `process.platform` is not win32/darwin/linux.    |
 */

import type { Launcher } from "./types.js";

export class NoTerminalFoundError extends Error {
  override readonly name = "NoTerminalFoundError";
  constructor() {
    super("No supported terminal emulator was found on this system.");
  }
}

export class InvalidLaunchCommandError extends Error {
  override readonly name = "InvalidLaunchCommandError";
  constructor(reason: string) {
    super(`Invalid launch command: ${reason}`);
  }
}

export class TerminalSpawnFailedError extends Error {
  override readonly name = "TerminalSpawnFailedError";
  constructor(
    public readonly launcher: Launcher,
    public readonly reason: string,
  ) {
    super(`Failed to launch ${launcher}: ${reason}`);
  }
}

export class UnsupportedPlatformError extends Error {
  override readonly name = "UnsupportedPlatformError";
  constructor(public readonly platform: string) {
    super(`Unsupported platform for terminal launch: ${platform}`);
  }
}
