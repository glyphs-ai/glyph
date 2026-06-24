/**
 * Aggregate re-export of package-private helpers. Downstream modules
 * (`dispatch.ts`, platform files, tests) can import from `_shared.ts`
 * for convenience; the actual implementations live in focused peer
 * modules split by concern:
 *
 *   _validate.ts — input validation (validateLaunchCommand, assertPortableEnvName)
 *   _quoting.ts  — quoting dialects, env-prefix builders, hasUsableEnv
 *   _spawn.ts    — realSpawn, waitForEarlyFailure, existsLike, whichSyncDefault
 */

export {
  escapeCmdArg,
  filterStringEntries,
  hasUsableEnv,
  pwshEnvPrefix,
  pwshQuote,
  shExportPrefix,
  shQuote,
} from "./_quoting.js";
export { existsLike, realSpawn, waitForEarlyFailure, whichSyncDefault } from "./_spawn.js";
export { assertPortableEnvName, validateLaunchCommand } from "./_validate.js";
