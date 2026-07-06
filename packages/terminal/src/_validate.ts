import { PORTABLE_ENV_NAME_RE } from "./_constants.js";
import { InvalidLaunchCommandError } from "./_errors.js";
import type { LaunchCommand } from "./types.js";

/** Reject command fields with control characters that could break shell/AppleScript quoting. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control chars is the explicit purpose.
const CONTROL_CHARS_RE = /[\x00-\x1f]/;

export function validateLaunchCommand(cmd: LaunchCommand): void {
  if (CONTROL_CHARS_RE.test(cmd.cwd)) {
    throw new InvalidLaunchCommandError("workdir contains a control character");
  }
  if (CONTROL_CHARS_RE.test(cmd.cmd)) {
    throw new InvalidLaunchCommandError("command contains a control character");
  }
  for (const a of cmd.args) {
    if (CONTROL_CHARS_RE.test(a)) {
      throw new InvalidLaunchCommandError("argument contains a control character");
    }
  }
  for (const name of Object.keys(cmd.env ?? {})) {
    assertPortableEnvName(name);
  }
}

function assertPortableEnvName(name: string): void {
  if (!PORTABLE_ENV_NAME_RE.test(name)) {
    throw new InvalidLaunchCommandError(
      `environment variable name ${JSON.stringify(name)} is not portable`,
    );
  }
}
