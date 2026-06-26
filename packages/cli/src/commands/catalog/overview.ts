/**
 * `glyph catalog overview` -- per-workspace catalog counts.
 */

import type { GetApiWorkspacesByIdCatalogOverviewResponses } from "@glyphs-ai/sdk";
import { makeSdkClient, resolveWorkspace } from "../../connect.js";
import { formatError, formatJson, formatRecord, pickFormat } from "../../output.js";
import type { WorkspaceFlagOpts } from "../../registrars/_shared.js";
import type { CommandResult } from "../../result.js";
import { unwrap } from "../../sdk-client.js";

export type CatalogOverviewOpts = WorkspaceFlagOpts;

export async function catalogOverview(opts: CatalogOverviewOpts = {}): Promise<CommandResult> {
  const { client } = await makeSdkClient(opts);
  try {
    const workspaceId = await resolveWorkspace(opts);
    const ov = unwrap(
      await client.get<GetApiWorkspacesByIdCatalogOverviewResponses>({
        url: "/api/workspaces/{id}/catalog/overview",
        path: { id: workspaceId },
      }),
    );
    const fmt = pickFormat(opts, "table");
    const stdout = fmt === "json" ? formatJson(ov) : formatRecord({ ...ov.counts });
    return { exitCode: 0, stdout };
  } catch (err) {
    return formatError(err);
  }
}
