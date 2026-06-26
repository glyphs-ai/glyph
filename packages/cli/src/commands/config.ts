/**
 * `glyph config` — `GET /api/config`. Surfaces the server's resolved
 * paths, listening host/port, and dashboard tunables. Useful for
 * scripting (`--json`) or verifying that an `GLYPH_HOME` override
 * landed where you expected.
 */

import { getApiConfig } from "@glyphs-ai/sdk";
import { makeSdkClient } from "../connect.js";
import { formatError, formatJson, formatRecord, pickFormat } from "../output.js";
import type { CommandResult } from "../result.js";
import { unwrap } from "../sdk-client.js";

export interface ConfigOpts {
  readonly server?: string;
  readonly home?: string;
  readonly output?: string;
  readonly json?: boolean;
}

export async function config(opts: ConfigOpts = {}): Promise<CommandResult> {
  await makeSdkClient(opts);
  try {
    const cfg = unwrap(await getApiConfig());
    const fmt = pickFormat(opts, "table");
    const stdout =
      fmt === "json"
        ? formatJson(cfg)
        : formatRecord({
            glyphHome: cfg.glyphHome,
            currentWorkspaceId: cfg.currentWorkspaceId ?? "(none)",
            host: cfg.host,
            port: cfg.port,
            pathSeparator: cfg.pathSeparator,
            tasksPollIntervalMs: cfg.tasks.pollIntervalMs,
          });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}
