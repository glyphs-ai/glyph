/**
 * `glyph catalog overview` -- per-workspace catalog counts.
 */

import { makeClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatRecord, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";

export type CatalogOverviewOpts = WorkspaceFlagOpts;

export async function catalogOverview(opts: CatalogOverviewOpts = {}): Promise<CommandResult> {
  const client = await makeClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const ov = await client.call("catalog.overview.get", { params: { id: workspaceId } });
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ov) : formatRecord({ ...ov.counts });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}
