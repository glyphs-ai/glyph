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
  constructor(launcher: Launcher, reason: string) {
    super(`Failed to launch ${launcher}: ${reason}`);
  }
}

export class UnsupportedPlatformError extends Error {
  override readonly name = "UnsupportedPlatformError";
  constructor(platform: string) {
    super(`Unsupported platform for terminal launch: ${platform}`);
  }
}
